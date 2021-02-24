# Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""
This file contains helper functions for updating the cache.
"""

import os
import defusedxml.ElementTree as ET
import json

import boto3
from botocore.exceptions import ClientError
from botocore.config import Config
from boto3.dynamodb.conditions import Key

import chalicelib.settings as msam_settings
import chalicelib.cloudwatch as cloudwatch_data
import chalicelib.connections as connection_cache
import chalicelib.nodes as node_cache
from chalicelib.cache import regions
import chalicelib.tags as tags

# table names generated by CloudFormation
ALARMS_TABLE_NAME = os.environ["ALARMS_TABLE_NAME"]
CONTENT_TABLE_NAME = os.environ["CONTENT_TABLE_NAME"]

# user-agent config
STAMP = os.environ["BUILD_STAMP"]
MSAM_BOTO3_CONFIG = Config(user_agent="aws-media-services-applications-mapper/{stamp}/periodic.py".format(stamp=STAMP))

SSM_LOG_GROUP_NAME = "MSAM/SSMRunCommand"


def update_alarms():
    """
    Entry point for the CloudWatch scheduled task to update subscribed alarm state.
    """
    try:
        print("update alarms")
        alarm_groups = {}
        # group everything by region
        for alarm in cloudwatch_data.all_subscribed_alarms():
            region_name = alarm["Region"]
            alarm_name = alarm["AlarmName"]
            if region_name not in alarm_groups:
                alarm_groups[region_name] = []
            alarm_groups[region_name].append(alarm_name)
        print(alarm_groups)
        # update each grouped list for a region
        for region_name in alarm_groups:
            alarm_names = alarm_groups[region_name]
            cloudwatch_data.update_alarms(region_name, alarm_names)
    except ClientError as error:
        print(error)
    return True


def update_connections():
    """
    Entry point for the CloudWatch scheduled task to discover and cache services.
    """
    try:
        connection_cache.update_connection_ddb_items()
    except ClientError as error:
        print(error)
    return True


def update_nodes():
    """
    This function is responsible for updating nodes for
    one region, or the global services.
    """
    return update_nodes_generic(
        update_global_func=node_cache.update_global_ddb_items,
        update_regional_func=node_cache.update_regional_ddb_items,
        settings_key="cache-next-region")


def update_ssm_nodes():
    """
    This function is responsible for updating SSM nodes
    """
    def skip():
        print("skipping global region")
    return update_nodes_generic(
        update_global_func=skip,
        update_regional_func=node_cache.update_regional_ssm_ddb_items,
        settings_key="ssm-cache-next-region")


def update_nodes_generic(update_global_func, update_regional_func, settings_key):
    """
    Entry point for the CloudWatch scheduled task to discover and cache services.
    """
    try:
        never_regions_key = "never-cache-regions"
        never_regions = msam_settings.get_setting(never_regions_key)
        if never_regions is None:
            never_regions = []
        # settings_key = "cache-next-region"
        # make a region name list
        region_name_list = []
        for region in regions():
            region_name = region["RegionName"]
            # exclude regions listed in never-cache setting
            if region_name not in never_regions:
                region_name_list.append(region_name)
            else:
                print("{} in {} setting".format(region_name, never_regions_key))
        # sort it
        region_name_list.sort()
        # get the next region to process
        next_region = msam_settings.get_setting(settings_key)
        # start at the beginning if no previous setting
        if next_region is None:
            next_region = region_name_list[0]
        # otherwise it's saved for us
        region_name = next_region
        # store the region for the next schedule
        try:
            # process global after the end of the region list
            if region_name_list.index(next_region) + 1 >= len(region_name_list):
                next_region = "global"
            else:
                next_region = region_name_list[region_name_list.index(next_region) + 1]
        except (IndexError, ValueError):
            # start over if we don't recognize the region, ex. global
            next_region = region_name_list[0]
        # store it
        msam_settings.put_setting(settings_key, next_region)
        # update the region
        print("updating nodes for region {}".format(region_name))
        if region_name == "global":
            update_global_func()
        else:
            update_regional_func(region_name)
    except ClientError as error:
        print(error)
    return region_name


def update_from_tags():
    """
    Updates MSAM diagrams and tiles from tags on cloud resources. Check for MSAM-Diagram and MSAM-Tile tags.
    """
    tags.update_diagrams()
    tags.update_tiles()


def ssm_run_command():
    """
    Runs all applicable SSM document commands on a given managed instance.
    """
    try:
        table_name = CONTENT_TABLE_NAME
        ssm_client = boto3.client('ssm', config=MSAM_BOTO3_CONFIG)
        db_resource = boto3.resource('dynamodb', config=MSAM_BOTO3_CONFIG)
        db_table = db_resource.Table(table_name)
        instance_ids = {}
        # get all the managed instances from the DB with tag MSAM-NodeType
        response = db_table.query(
            IndexName="ServiceRegionIndex",
            KeyConditionExpression=Key("service").eq("ssm-managed-instance"),
            FilterExpression="contains(#data, :tagname)",
            ExpressionAttributeNames={"#data": "data"},
            ExpressionAttributeValues={":tagname": "MSAM-NodeType"}
            )
        items = response.get("Items", [])
        while "LastEvaluatedKey" in response:
            response = db_table.query(
            IndexName="ServiceRegionIndex",
            KeyConditionExpression=Key("service").eq("ssm-managed-instance"),
            FilterExpression="contains(#data, :tagname)",
            ExpressionAttributeNames={"#data": "data"},
            ExpressionAttributeValues={":tagname": "MSAM-NodeType"},
            ExclusiveStartKey=response['LastEvaluatedKey']
            )
            items.append(response.get("Items", []))

        for item in items:
            data = json.loads(item['data'])
            if "MSAM-NodeType" in data["Tags"]:
                instance_ids[data['Id']] = data['Tags']['MSAM-NodeType']

        # get all the SSM documents applicable to MSAM, filtering by MSAM-NodeType tag
        # When we support more than just ElementalLive, add to the list of values for MSAM-NodeType during filtering
        document_list = ssm_client.list_documents(
            Filters=[
                {
                    'Key': 'tag:MSAM-NodeType',
                    'Values': [
                        'ElementalLive',
                    ]
                },
                {
                    'Key': 'Owner',
                    'Values': [
                        'Self'
                    ]
                }
            ]
        )
        document_ids = document_list['DocumentIdentifiers']
        while "NextToken" in document_list:
            document_list = ssm_client.list_documents(
                Filters=[
                    {
                        'Key': 'tag:MSAM-NodeType',
                        'Values': [
                            'ElementalLive',
                        ]
                    },
                    {
                        'Key': 'Owner',
                        'Values': [
                            'Self'
                        ]
                    }
                ],
                NextToken=document_list["NextToken"]
            )
            document_ids.append(document_list['DocumentIdentifiers'])

        document_names = {}
        for document in document_ids:
            if "Tags" in document:
                for tag in document["Tags"]:
                    if tag['Key'] == "MSAM-NodeType":
                        document_names[document["Name"]] = tag['Value']

        # loop over all instances and run applicable commands based on node type
        for instance_id, id_type in instance_ids.items():
            for name, doc_type in document_names.items():
                if id_type in doc_type:
                    # maybe eventually doc type could be comma-delimited string if doc applies to more than one type?
                    print("running command: %s on %s " % (name, instance_id))
                    try:
                        response = ssm_client.send_command(
                            InstanceIds=[
                                instance_id,
                            ],
                            DocumentName=name,
                            TimeoutSeconds=600,
                            Parameters={
                            },
                            MaxConcurrency='50',
                            MaxErrors='0',
                            CloudWatchOutputConfig={
                                'CloudWatchLogGroupName': SSM_LOG_GROUP_NAME,
                                'CloudWatchOutputEnabled': True
                            }
                        )
                        print(response)
                    except ClientError as error:
                        print(error)
                        if error.response['Error']['Code'] == "InvalidInstanceId":
                            continue
    except ClientError as error:
        print(error)


def process_ssm_run_command(event):
    """
    Processes the results from running an SSM command on a managed instance.
    """
    event_dict = event.to_dict()
    instance_id = event_dict['detail']['instance-id']
    command_name = event_dict['detail']['document-name']
    command_status = event_dict['detail']['status']
    cw_client = boto3.client('cloudwatch', config=MSAM_BOTO3_CONFIG)
    log_client = boto3.client('logs', config=MSAM_BOTO3_CONFIG)
    dimension_name = "Instance ID"
    metric_name = command_name
    status = 0

    try:
        # test to make sure stream names are always of this format, esp if you create your own SSM document
        log_stream_name = event_dict['detail']['command-id'] + "/" + instance_id + "/aws-runShellScript/stdout"

        response = log_client.get_log_events(
                logGroupName=SSM_LOG_GROUP_NAME,
                logStreamName=log_stream_name,
            )
        #print(response)
        if command_status == "Success":
            # process document name (command)
            if "MSAMElementalLiveStatus" in command_name:
                metric_name = "MSAMElementalLiveStatus"
                for log_event in response['events']:
                    if "running" in log_event['message']:
                        status = 1
                        break
            elif "MSAMSsmSystemStatus" in command_name:
                metric_name = "MSAMSsmSystemStatus"
                status = 1
            elif "MSAMElementalLiveActiveAlerts" in command_name:
                metric_name = "MSAMElementalLiveActiveAlerts"
                root = ET.fromstring(response['events'][0]['message'])
                status = len(list(root))
                if status == 1 and root[0].tag == "empty":
                    status = 0
            else:
                if "MSAMElementalLiveCompletedEvents" in command_name:
                    metric_name = "MSAMElementalLiveCompletedEvents"
                elif "MSAMElementalLiveErroredEvents" in command_name:
                    metric_name = "MSAMElementalLiveErroredEvents"
                elif "MSAMElementalLiveRunningEvents" in command_name:
                    metric_name = "MSAMElementalLiveRunningEvents"
                root = ET.fromstring(response['events'][0]['message'])
                status = len(root.findall("./live_event"))
        else:
            # for the elemental live status, the command itself returns a failure if process is not running at all
            # which is different than when a command fails to execute altogether
            if command_status == "Failed" and "MSAMElementalLiveStatus" in command_name:
                for log_event in response['events']:
                    if "Not Running" in log_event['message'] or "Active: failed" in log_event['message']:
                        metric_name = "MSAMElementalLiveStatus"
                        break
            else:
                # log if command has timed out or failed
                print("SSM Command Status: Command %s sent to instance %s has %s" % (command_name, instance_id, command_status))
                # create a metric for it
                status = 1
                metric_name = "MSAMSsmCommand"+command_status

        cw_client.put_metric_data(
            Namespace = SSM_LOG_GROUP_NAME,
            MetricData = [
                {
                    'MetricName': metric_name,
                    'Dimensions': [
                        {
                            'Name' : dimension_name,
                            'Value' : instance_id
                        },
                    ],
                    "Value": status,
                    "Unit": "Count"
                }
            ]
        )
    except ClientError as error:
        print(error)
        print("SSM Command Status: Command %s sent to instance %s has status %s" % (command_name, instance_id, command_status))
        print("Log stream name is %s" % (log_stream_name))

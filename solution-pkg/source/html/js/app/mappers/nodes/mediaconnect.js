/*! Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
       SPDX-License-Identifier: Apache-2.0 */

define(["jquery", "app/server", "app/connections", "app/regions", "app/model", "app/ui/svg_node"],
    function($, server, connections, region_promise, model, svg_node) {

        var update_flows = function() {
            var current = connections.get_current();
            var url = current[0];
            var api_key = current[1];
            return new Promise(function(resolve, reject) {
                server.get(url + "/cached/mediaconnect-flow", api_key).then(function(flows) {
                    for (let cache_entry of flows) {
                        // console.log(cache_entry);
                        map_flow(cache_entry);
                    }
                    resolve();
                }).catch(function(error) {
                    console.log(error);
                    reject(error);
                });
            });
        };


        var map_flow = function(cache_entry) {
            var flow = JSON.parse(cache_entry.data);
            var name = flow.Name;
            var id = flow.FlowArn;
            var nodes = model.nodes;
            var rgb = "#99ff33";
            var node_type = "MediaConnect Flow";
            var node_data = {
                "overlay": "informational",
                "cache_update": cache_entry.updated,
                "id": id,
                "region": cache_entry.region,
                "shape": "image",
                "image": {
                    "unselected": null,
                    "selected": null
                },
                "header": "<b>" + node_type + ":</b> " + name,
                "data": flow,
                "title": node_type,
                "name": name,
                "size": 55,
                "render": {
                    normal_unselected: (function() {
                        var local_node_type = node_type;
                        var local_name = name;
                        var local_rgb = rgb;
                        var local_id = id;
                        return function() {
                            return svg_node.unselected(local_node_type, local_name, local_rgb, local_id);
                        };
                    })(),
                    normal_selected: (function() {
                        var local_node_type = node_type;
                        var local_name = name;
                        var local_rgb = rgb;
                        var local_id = id;
                        return function() {
                            return svg_node.selected(local_node_type, local_name, local_rgb, local_id);
                        };
                    })(),
                    alert_unselected: (function() {
                        var local_node_type = node_type;
                        var local_name = name;
                        var local_id = id;
                        return function() {
                            return svg_node.unselected(local_node_type, local_name, "#ff0000", local_id);
                        };
                    })(),
                    alert_selected: (function() {
                        var local_node_type = node_type;
                        var local_name = name;
                        var local_id = id;
                        return function() {
                            return svg_node.selected(local_node_type, local_name, "#ff0000", local_id);
                        };
                    })()
                },
                "console_link": (function() {
                    var split_id = id.split(":");
                    var region = split_id[3];
                    return function() {
                        var html = `https://${region}.console.aws.amazon.com/mediaconnect/home?region=${region}#/flows/${id}`;
                        return html;
                    };
                })(),
                "cloudwatch_link": (function() {
                    var split_id = id.split(":");
                    var region = split_id[3];
                    var name = split_id[split_id.length - 1];
                    return function() {
                        var html = `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#metricsV2:graph=~();query=~'*7bAWS*2fMediaConnect*2cFlowARN*7d*20${name}`;
                        return html;
                    };
                })()
            };
            node_data.image.selected = node_data.render.normal_selected();
            node_data.image.unselected = node_data.render.normal_unselected();
            nodes.update(node_data);
        };


        var update = function() {
            return update_flows();
        };

        return {
            "name": "MediaConnect Flows",
            "update": update
        };
    });
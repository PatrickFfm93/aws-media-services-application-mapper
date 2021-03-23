/*! Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
       SPDX-License-Identifier: Apache-2.0 */

define(["lodash", "app/server", "app/connections"], function(_, server, connections) {

    const retrieve_channel = _.memoize(function(name) {
        const current_connection = connections.get_current();
        const url = current_connection[0];
        const api_key = current_connection[1];
        const current_endpoint = `${url}/channel/${name}`;
        return new Promise(function(resolve, reject) {
            server.get(current_endpoint, api_key).then(function(response) {
                resolve(response);
            }).catch(function(error) {
                console.log(error);
                reject(error);
            });
        });
    });

    const have_any = _.memoize(function(node_ids) {
        const local_lodash = _;
        const local_node_ids = node_ids;
        // console.log(node_ids);
        const matches = [];
        // return a list of channel names that have any of these nodes
        return new Promise(function(outer_resolve, outer_reject) {
            const promises = [];
            channel_list().then(function(channel_names) {
                for (let name of channel_names) {
                    const local_name = name;
                    promises.push(
                        new Promise(function(resolve, reject) {
                            // console.log(name);
                            // look for model matches
                            retrieve_channel(local_name).then(function(contents) {
                                const channel_keys = Object.keys(contents).sort();
                                const intersect = local_lodash.intersection(local_node_ids, channel_keys);
                                // console.log(intersect);
                                if (intersect.length > 0) {
                                    matches.push(local_name);
                                }
                                resolve();
                            });
                        })
                    );
                }
            });
            Promise.all(promises).then(function() {
                // return it all
                outer_resolve(matches);
            });
        });
    });

    const create_channel = function(name, nodes) {
        const current_connection = connections.get_current();
        const url = current_connection[0];
        const api_key = current_connection[1];
        const current_endpoint = `${url}/channel/${name}`;
        return new Promise(function(resolve, reject) {
            const data = nodes;
            server.post(current_endpoint, api_key, data).then(function(response) {
                clear_function_cache();
                resolve(response);
            }).catch(function(error) {
                console.log(error);
                reject(error);
            });
        });
    };

    const update_channel = create_channel;

    const delete_channel = function(name) {
        const current_connection = connections.get_current();
        const url = current_connection[0];
        const api_key = current_connection[1];
        const current_endpoint = `${url}/channel/${name}`;
        return new Promise((resolve, reject) => {
            server.delete_method(current_endpoint, api_key).then((response) => {
                clear_function_cache();
                resolve(response);
            }).catch(function(error) {
                console.log(error);
                reject(error);
            });
        });
    };

    const channel_list = _.memoize(function() {
        const current_connection = connections.get_current();
        const url = current_connection[0];
        const api_key = current_connection[1];
        const current_endpoint = `${url}/channels`;
        return new Promise(function(resolve, reject) {
            server.get(current_endpoint, api_key).then(function(response) {
                resolve(response);
            }).catch(function(error) {
                console.log(error);
                reject(error);
            });
        });
    });

    const arn_to_channels = _.memoize(function(arn) {
        const local_arn = arn;
        return new Promise(function(outerResolve, outerReject) {
            channel_list().then(function(channels) {
                const matches = [];
                const promises = [];
                for (let channel_name of channels) {
                    const local_channel_name = channel_name;
                    promises.push(new Promise(function(resolve, reject) {
                        retrieve_channel(local_channel_name).then(function(members) {
                            for (let member_value of members) {
                                if (member_value.id === local_arn) {
                                    matches.push(local_channel_name);
                                    break;
                                }
                            }
                            resolve();
                        });
                    }));
                }
                Promise.all(promises).then(function() {
                    outerResolve(matches.sort());
                });
            }).catch(function(error) {
                console.log(error);
                outerReject(error);
            });
        });
    });

    const clear_function_cache = function() {
        have_any.cache.clear();
        retrieve_channel.cache.clear();
        channel_list.cache.clear();
        arn_to_channels.cache.clear();
    };

    const delete_all_channels = function() {
        const current_connection = connections.get_current();
        const url = current_connection[0];
        const api_key = current_connection[1];
        const current_endpoint = `${url}/channels`;
        return new Promise((resolve, reject) => {
            server.delete_method(current_endpoint, api_key).then((response) => {
                clear_function_cache();
                resolve(response);
            }).catch(function(error) {
                console.log(error);
                reject(error);
            });
        });
    };

    // pre-warming the function cache to speed tile drawing

    async function prewarm() {
        const channels = await channel_list();
        for (let name of channels) {
            retrieve_channel(name);
        }
    }

    prewarm();

    return {
        "create_channel": create_channel,
        "update_channel": update_channel,
        "delete_channel": delete_channel,
        "retrieve_channel": retrieve_channel,
        "channel_list": channel_list,
        "arn_to_channels": arn_to_channels,
        "have_any": have_any,
        "delete_all": delete_all_channels
    };
});
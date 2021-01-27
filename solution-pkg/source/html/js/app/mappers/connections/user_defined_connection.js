/*! Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
       SPDX-License-Identifier: Apache-2.0 */

// {
//     "arn": "<FROM-ARN>:<TO-ARN>",
//     "expires": 1535860952,
//     "from": "<FROM-ARN>",
//     "region": "global",
//     "service": "user-defined-node-interconnect",
//     "to": "<TO-ARN>",
//     "updated": 1535853752
// }

define(["jquery", "app/model", "app/server", "app/connections"],
    function($, model, server, connections) {

        var update_connections = function() {
            var current = connections.get_current();
            var url = current[0];
            var api_key = current[1];
            return new Promise((resolve, reject) => {
                server.get(url + "/cached/user-defined-connection", api_key).then((connections) => {
                    for (let connection of connections) {
                        var data;
                        if (!connection.data) {
                            data = {};
                        } else {
                            data = JSON.parse(connection.data);
                        }
                        model.edges.update({
                            "id": connection.arn,
                            "to": connection.to,
                            "from": connection.from,
                            "label": connection.label,
                            "data": data,
                            "arrows": "to",
                            "color": {
                                "color": "black"
                            }
                        });
                    }
                    resolve();
                });
            });
        };

        var update = function() {
            return update_connections();
        };

        return {
            "name": "User-Defined Node Connections",
            "update": update
        };
    });
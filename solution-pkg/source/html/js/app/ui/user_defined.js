/*! Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
       SPDX-License-Identifier: Apache-2.0 */

define(["jquery", "lodash", "app/ui/diagrams", "app/model", "app/ui/alert"],
    function($, _, diagrams, model, alert) {

        var add_connection_compartment = "connect-nodes-button";
        var remove_connection_compartment = "delete-connection-button";
        var add_connection_button = "connect-nodes-button";
        var remove_connection_button = "delete-connection-button";
        var label_edit_compartment = "edit-connection-button";
        var label_edit_button = "edit-connection-button";
        // var label_edit_input = "label-edit-input";


        var create_connection_record = function(options) {
            var updated = moment(new Date());
            var expires = moment(updated).add(1, 'y');
            var data = {
                "user-defined": true,
                "from": `${options.from}`,
                "to": `${options.to}`,
                "expires": options.expires || expires.unix()
            };
            var record = {
                "arn": `${options.from}:${options.to}`,
                "data": JSON.stringify(data),
                "expires": options.expires || expires.unix(),
                "label": options.label || "new connection",
                "from": `${options.from}`,
                "region": "global",
                "service": "user-defined-connection",
                "to": `${options.to}`,
                "updated": updated.unix()
            };
            return record;
        }

        var show_add_connection = (visible) => {
            if (visible) {
                $("#" + add_connection_compartment).removeClass("hidden-compartment");
            } else {
                $("#" + add_connection_compartment).addClass("hidden-compartment");
            }
        };

        var show_remove_connection = (visible) => {
            if (visible) {
                $("#" + remove_connection_compartment).removeClass("hidden-compartment");
            } else {
                $("#" + remove_connection_compartment).addClass("hidden-compartment");
            }
        };

        var show_edit_connection = (visible) => {
            if (visible) {
                $("#" + label_edit_compartment).removeClass("hidden-compartment");
            } else {
                $("#" + label_edit_compartment).addClass("hidden-compartment");
            }
        };

        $("#" + add_connection_button).click((event) => {
            // add a connection to the model
            show_add_connection(false);
            var diagram = diagrams.shown();
            console.log(`diagram is ${diagram.name}`);
            var selected = diagram.network.getSelectedNodes();
            if (selected.length == 2) {
                // add the new connection to the REST API
                var record = create_connection_record({
                    "from": selected[0],
                    "to": selected[1]
                });
                // write the table first, don't wait
                model.put_records(record).then(function(result) {
                    alert.show("Saved connection");
                }).catch(function(error) {
                    console.log(error);
                    alert.show("Error saving connection");
                });
                // update in-memory model
                model.edges.update({
                    "id": record.arn,
                    "to": record.to,
                    "from": record.from,
                    "label": record.label,
                    "data": JSON.parse(record.data),
                    "arrows": "to",
                    "color": {
                        "color": "black"
                    }
                });
                // refresh each diagram containing to and from nodes
                var matches = diagrams.have_all([record.to, record.from]);
                for (let match of matches) {
                    // we only need to sync one side of the connection
                    match.synchronize_edges("add", [record.from]);
                }
                // done
            } else {
                console.log("only two nodes can be selected");
            }
        });

        $("#" + remove_connection_button).click((event) => {
            show_remove_connection(false);
            show_edit_connection(false);
            var diagram = diagrams.shown();
            console.log(`diagram is ${diagram.name}`);
            var selected = diagram.network.getSelectedEdges();
            if (selected.length == 1) {
                var edge = model.edges.get(selected[0]);
                // delete the connection from the REST API
                model.delete_record(edge.id).then(function() {
                    alert.show("Deleted");
                }).catch(function(error) {
                    console.log(error);
                    alert.show("Error deleting connection");
                });
                // refresh the diagrams
                model.edges.remove(edge.id);
                // refresh each diagram containing to and from nodes
                var matches = diagrams.have_all([edge.to, edge.from]);
                for (let match of matches) {
                    // we only need to sync one side of the connection
                    match.edges.remove(edge.id);
                }
                // done
            } else {
                console.log("only one connection can be selected");
            }
        });

        $("#" + label_edit_button).click((event) => {
            // open the create/edit connection dialog
            $('#edit_connection_dialog_expiration').datepicker({
                format: 'yyyy-mm-dd',
                startDate: new Date().toDateString()
            });
            $("#edit_connection_dialog").modal("show");
            // update the dialog fields
            var diagram = diagrams.shown();
            console.log(`diagram is ${diagram.name}`);
            var selected = diagram.network.getSelectedEdges();
            if (selected.length == 1) {
                var edge = model.edges.get(selected[0]);
                $("#edit_connection_dialog_label").val(edge.label);
                var expires = new Date();
                expires.setTime(edge.data.expires * 1000);
                var initial = `${expires.getFullYear()}/${expires.getMonth()+1}/${expires.getDate()}`;
                $('#edit_connection_dialog_expiration').datepicker('update', initial);
            }
        });

        $("#edit_connection_dialog_proceed").click((event) => {
            $("#edit_connection_dialog").modal('hide');
            var expires_seconds = moment($("#edit_connection_dialog_expiration").val()).format("X");
            // var expires_seconds = (Date.parse($("#edit_connection_dialog_expiration").val()) / 1000).toFixed(0);
            var diagram = diagrams.shown();
            console.log(`diagram is ${diagram.name}`);
            var selected = diagram.network.getSelectedEdges();
            if (selected.length == 1) {
                var edge = model.edges.get(selected[0]);
                var new_expires = Number.parseInt(expires_seconds);
                var new_label = $("#edit_connection_dialog_label").val();
                // add the new connection to the REST API
                var record = create_connection_record({
                    "from": edge.from,
                    "to": edge.to,
                    "label": new_label,
                    "expires": new_expires
                });
                // console.log(record);
                // write the table first
                model.put_records(record).then(function(result) {
                    // done
                    alert.show("Saved");
                }).catch(function(error) {
                    console.log(error);
                    alert.show("Error saving changes");
                });
                // refresh the diagrams
                var updated_edge = {
                    "id": edge.id,
                    "to": edge.to,
                    "from": edge.from,
                    "label": record.label,
                    "data": JSON.parse(record.data),
                    "arrows": "to",
                    "color": {
                        "color": "black"
                    }
                };
                // console.log(updated_edge);
                // update in-memory model
                model.edges.update(updated_edge);
                // refresh each diagram containing to and from nodes
                var matches = diagrams.have_all([edge.to, edge.from]);
                for (let match of matches) {
                    match.edges.update(updated_edge);
                }
            } else {
                console.log("only one connection can be selected");
            }
        });

        diagrams.add_selection_callback(function(diagram, event) {
            if (event.nodes.length == 2) {
                var diagram = diagrams.shown();
                var connected = diagram.network.getConnectedNodes(event.nodes[0]);
                // console.log(connected);
                if (!connected.includes(event.nodes[1])) {
                    show_add_connection(true);
                }
            } else {
                show_add_connection(false);
            }
            if (event.edges.length == 1 && event.nodes.length == 0) {
                var diagram = diagrams.shown();
                var edge = diagram.edges.get(event.edges[0]);
                show_remove_connection(edge.data["user-defined"]);
                show_edit_connection(edge.data["user-defined"]);
            } else {
                show_remove_connection(false);
                show_edit_connection(false);
            }
        });

    });
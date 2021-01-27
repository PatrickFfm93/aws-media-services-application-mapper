/*! Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
       SPDX-License-Identifier: Apache-2.0 */

define(["jquery", "lodash", "app/model", "app/channels", "app/ui/diagrams"],
    function($, _, model, channels, diagrams) {
        // options for Fuse
        var model_options = {
            shouldSort: true,
            tokenize: true,
            matchAllTokens: true,
            threshold: 0.25,
            location: 0,
            distance: 100,
            maxPatternLength: 32,
            minMatchCharLength: 2,
            keys: [
                "id",
                "label",
                "title",
                "name",
                "data.Arn",
                "data.ARN",
                "data.Channel",
                "data.DomainName",
                "data.Id",
                "data.Name",
                "data.Url",
                "data.Sources.Url",
                "data.Origin.Items.DomainName",
                "data.Origin.Items.OriginPath",
                "data.Destinations.Settings.Url",
                "data.HlsIngest.IngestEndpoints.Url",
                // SSM and EC2 instances
                "data.Data.AWS:InstanceInformation.Content.ComputerName",
                "data.Data.AWS:InstanceInformation.Content.IpAddress",
                "data.PrivateDnsName",
                "data.PrivateIpAddress",
                "data.PublicDnsName",
                "data.PublicIpAddress"
            ]
        };

        var fuse_model;

        var cached_tile_names;

        var update = function() {
            fuse_model = new Fuse(model.nodes.get(), model_options);
            channels.channel_list().then(function(channels) {
                cached_tile_names = channels;
            });
        };

        var search_nodes = function(text) {
            return fuse_model.search(text);
        };

        var search_tiles = function(text) {
            var matches = [];
            for (let name of cached_tile_names) {
                if (name.toLowerCase().includes(text.toLowerCase())) {
                    matches.push(name);
                }
            }
            return matches;
        };

        function search(text) {
            return new Promise(function(outer_resolve, outer_reject) {
                fuse_model = new Fuse(model.nodes.get(), model_options);
                var results = {
                    text: text,
                    model: [],
                    tile_names: [],
                    tile_contents: [],
                    diagram_names: [],
                    diagram_contents: []
                };
                // search the model, find matching nodes
                var model_matches = fuse_model.search(text);
                var node_ids = _.map(model_matches, "id");
                results.model = model_matches;
                // find diagrams with one or more of the nodes
                var contained_by = diagrams.have_any(node_ids);
                results.diagram_contents = contained_by;
                // find diagram name matches
                for (let name of Object.keys(diagrams.get_all())) {
                    var includes = name.toLowerCase().includes(text.toLowerCase());
                    if (includes) {
                        results.diagram_names.push(name);
                    }
                }
                // find tiles with any of these nodes
                channels.have_any(node_ids).then(function(matches) {
                    results.tile_contents = matches;
                });
                // find tiles with the text or containing the model nodes
                var processed = 0;
                channels.channel_list().then(function(channel_names) {
                    for (let channel_name of channel_names) {
                        // check for a name partial match
                        var includes = channel_name.toLowerCase().includes(text.toLowerCase());
                        if (includes) {
                            results.tile_names.push(channel_name);
                        }
                        // check the contents of the channel
                        channels.retrieve_channel(channel_name).then(function(contents) {
                            var channel_node_ids = _.map(contents, "id").sort();
                            var intersect = _.intersection(node_ids, channel_node_ids);
                            if (intersect.length > 0) {
                                results.tile_contents.push({
                                    tile: channel_name,
                                    found: intersect
                                });
                            }
                            processed++;
                            if (processed == channel_names.length) {
                                outer_resolve(results);
                            }
                        });
                    }
                });
            });
        }

        return {
            "search_nodes": search_nodes,
            "search_tiles": search_tiles,
            "update": update,
            search: search
        };
    });
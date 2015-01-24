
$(document).ready(function() {

	var w = $(window).width(),
	    h = $(window).height(),
	    routes = {},
	    city = {
	    	lon: 122.4417686,
	    	lat: 37.7682044
	    };

	// eats latitude/longitude, spits out x/y
	var projection = d3.geo.albers() 
	      .translate([w*3/8, h/2]) 
	      .scale(270000) 
	      .rotate([city.lon, 0]) 
	      .center([0, city.lat]); 

	var path = d3.geo.path().projection(projection);
	var line = d3.svg.line()
                     .x(function(d) { return projection([d.lon, d.lat])[0]; })
                     .y(function(d) { return projection([d.lon, d.lat])[1]; })
                     .interpolate("linear");

	var zoom = d3.behavior.zoom()
		.translate(projection.translate())
		.scale(projection.scale())
		.scaleExtent([270000,4000000])
		.on("zoom", function() {
			projection.translate(d3.event.translate).scale(d3.event.scale);
			svg.selectAll(".maplayer").attr("d", path);
			svg.selectAll(".route_path").attr("d", function(d) {
				return line(d.point);
			});
			svg.selectAll(".vehicle_mark").attr("cx", function(d) {
			    return projection([d.lon, d.lat])[0];
			});
			svg.selectAll(".vehicle_mark").attr("cy", function(d) {
			    return projection([d.lon, d.lat])[1];
			});
			svg.selectAll(".vehiclemarkers").attr("transform", "");
	});

	var svg = d3.select("#map").insert("svg").attr("width", w*3/4).attr("height", h);
	svg.call(zoom);
	// streets, arteries, freeways and neighborhood geojson files, combined into one
	svg_load_paths("sfmaps/sf.json", "maplayer"); 
	
	// Using this array to denote trains vs busses in the UI
	var lightrail_routes = ['F', 'J', 'KT', 'L', 'M', 'N', 'S'];

	// Initial fetches of information for all routes
	my_agency = "sf-muni";
	fetchRoutesForAgency(my_agency);
	setTimeout(registerListeners, 2000);

	// Every 15 seconds, get new location data from nextbus
	// But only for the routes which are selected
	next_update_feedback();
	setInterval(pollSelected, 15000);

	// Keep the display up-to-date
	setTimeout(function() {
		drawRoutePaths(my_agency);
		setInterval(refreshDisplay, 500);
	}, 3000);


	/*
	* Gets list of all routes in agency 
	*
	* agency_tag - unique identifier used by nextbus to denote transit agencies
	*/
	function fetchRoutesForAgency(agency_tag) {
		var queryString = "http://webservices.nextbus.com/service/publicXMLFeed?command=routeList&a=" + agency_tag;
		var retry = 0;
		// initialize this agency object in datastore
		routes[agency_tag] = {};
		routes[agency_tag]['routes'] = {}
		do {
			d3.xml(queryString, function(error, xml) {
				if (error) { retry = 1; return; }

				// Save list of routes as JSON object
				var json = $.xml2json(xml);
				$.each(json['route'], function(i,d) {
					fetchRouteConfig(agency_tag, d.tag);
				});
			});
		} while(retry);
	}

	/*
	* Gets configuration details for each route_tag in agency
	*
	* agency_tag - unique identifier used by nextbus to denote transit agencies
	* route_tag  - unique route identifier
	*/
	function fetchRouteConfig(agency_tag, route_tag) {
		queryString = "http://webservices.nextbus.com/service/publicXMLFeed?command=routeConfig&a=" + agency_tag + "&r=" + route_tag;  //  + "&terse" to exclude path data
		var retry = 0;

		do {
			d3.xml(queryString, function(error, xml) {
				if (error) { retry = 1; return; }
				
				var json = $.xml2json(xml);
				routes[agency_tag]['routes'][route_tag] = json.route;
				routes[agency_tag]['routes'][route_tag]['last_time'] = 0;
				routes[agency_tag]['routes'][route_tag]['poll'] = false;
				var rp_button = "<div id='routepicker_" + route_tag + "' class='button route_toggle'>" + route_tag + "</div>";
				if ($.inArray(route_tag, lightrail_routes) != -1) {
					$("#rp_lightrail").append(rp_button);
				} else {
					$("#rp_bus").append(rp_button);
				}

				pollVehicleLocationsForRoute(my_agency, route_tag);
			});
		} while(retry);
	}

	/*
	* Gets the vehicle information, including locations, for route
	*
	* agency_tag - unique identifier used by nextbus to denote transit agencies
	* route_tag  - unique route identifier
	*/
	function pollVehicleLocationsForRoute(agency_tag, route_tag) {

		var queryString = "http://webservices.nextbus.com/service/publicXMLFeed?command=vehicleLocations&a=" + agency_tag + "&r=" + route_tag + "&t=" + routes[agency_tag]['routes'][route_tag]['last_time'];
		var retry = 0;
		do {
			d3.xml(queryString, function(error, xml) {
				if (error) { retry = 1; return; }
				json = $.xml2json(xml);

				// update last_time to the one in this response
				routes[agency_tag]['routes'][route_tag]['last_time'] = json['lastTime']['time'];

				// merge any previous vehicles with batch. Match by vehicle id key
				var vehicles;
				if (typeof routes[agency_tag]['routes'][route_tag]['vehicles'] == 'undefined') {
					routes[agency_tag]['routes'][route_tag]['vehicles'] = [];
				}
				vehicles = routes[agency_tag]['routes'][route_tag]['vehicles'];

				if (typeof json.vehicle !== 'undefined') {
					for (var i=0; i<json.vehicle.length; i++) {
						var isnew = true;
						for (var j=0; j<vehicles.length; j++) {
							// update any matches
							if (vehicles[j]['id'] == json.vehicle[i]['id']) {
								json.vehicle[i].lon_init = vehicles[j].lon_init;
								json.vehicle[i].lat_init = vehicles[j].lat_init;
								vehicles[j] = json.vehicle[i];
								isnew = false;
								break;
							} else {
								continue;
							}
						}
						// if no match, append the new vehicle
						if (isnew) {
							json.vehicle[i].lon_init = json.vehicle[i].lon;
							json.vehicle[i].lat_init = json.vehicle[i].lat;
							routes[agency_tag]['routes'][route_tag]['vehicles'].push(json.vehicle[i]);
						}
					}
				}
			});
		} while (retry);
	}


	/*
	* Retrieve information for routes that user has selected
	*
	* We are keeping track of selections in the boolean: routes[agency]['routes'][route]['poll']
	*
	*/
	function pollSelected() {

		$.each(routes[my_agency]['routes'], function(i,d) {
			if (d['poll']) {
				pollVehicleLocationsForRoute(my_agency, d.tag);
			}
		});
		next_update_feedback();
	}

	/*
	* Reads from data in memory and updates svg elements
	*
	*/
	function refreshDisplay() {
		$.each(routes[my_agency]['routes'], function(i,d) {
				displayVehiclesForRoute(my_agency, d.tag);
		});
	}

	/*
	* Draws a line along the path that each bus route travels
	*/
	function drawRoutePaths(agency_tag, route_tag) {
		$.each(routes[agency_tag]['routes'], function(i,route) {
			var p = svg.selectAll("path.route")
		       .data(routes[agency_tag]['routes'][route.tag]['path'])
		       .enter()
		       .append("path")
		       .attr("d", function(d) {
		       		//console.log("route_" + route.tag, d.point);
		       		return line(d.point);
		       	})
		       .attr("class", "route_path route_path_" + route.tag)
		       .attr("visibility", "hidden")
		       .attr("stroke", "#" + routes[agency_tag]['routes'][route.tag]['color'])
		       .attr("stroke-width", 1)
		       .attr("fill", 'none');
		});
	}

	/*
	* Reads from data in memory and updates svg elements
	*
	* D3 handles any new, or removed data elements with its .enter() and .exit() handlers
	*
	*/
	function displayVehiclesForRoute(agency_tag, route_tag) {

		var vehicles = svg.selectAll(".route_" + route_tag)
			.data(routes[agency_tag]['routes'][route_tag]['vehicles']);

			
		vehicles
		    .transition()
		    .duration(500)
		    .ease('linear')

			.attr("transform", function(d) {
				return build_vehicle_transform(d.lon, d.lat, d.lon_init, d.lat_init);
			});
			
			/*
			Eliminated update of circle position in favor of transforms of svg groups
			reason: transforms allow a nice animated movement

		    .attr("cx", function(d) {
	            return projection([d.lon, d.lat])[0];
	        })
	        .attr("cy", function(d) {
	            return projection([d.lon, d.lat])[1];
	        })
			*/

	    // add any new vehicles
		vehicles.enter()
			.append('g')
			  	.attr("class", function(d) {
					return "vehiclemarkers route_" + route_tag;
			  	})
			  	.attr("id", function(d) {
					return "vehicle_" + d.id;
				})
			  	.attr("visibility", function(){
			  		if (routes[agency_tag]['routes'][route_tag]['poll']) {
			  			return "visible";
			  		} else {
			  			return "hidden";
			  		}
			  	})
		  	.append("circle")
		  		.attr("class", "vehicle_mark")
		    	.attr("cx", function(d) {
		            return projection([d.lon, d.lat])[0];
		        })
		        .attr("cy", function(d) {
		            return projection([d.lon, d.lat])[1];
		        })
		    	.attr("r", 3)
		    	.attr("fill", "#" + routes[agency_tag]['routes'][route_tag]['color'])
		    .append("svg:title")
          		.text(function(d, i) { return "Route: " + d.routeTag + ", Vehicle: " + d.id + ", Speed: " + d.speedKmHr + " kph"});

		vehicles.exit().remove();
	}

	/*
	* Loading GeoJSON sources (SF maps)
	*/
	function svg_load_paths(json_src, html_class) {
		d3.json(json_src, function(d) {
		    svg.selectAll("path")
		       .data(d.features)
		       .enter()
		       .append("path")
		       .attr("d", path)
		       .attr("class", html_class);
		});
	}

	function registerListeners() {

		$(".all_route_toggle").on('click', function() {
			if ($(this).hasClass("selected")) {
				$(this).removeClass("selected");
				$(this).text('All');
				$(".route_toggle").removeClass("selected");

				$.each(routes[my_agency]['routes'], function(i,d) {
					hideVehicles(d.tag);
				});

			} else {
				$(this).addClass("selected");
				$(this).text('None');
				$(".route_toggle").addClass("selected");
				$.each(routes[my_agency]['routes'], function(i,d) {
					showVehicles(d.tag);
					$('#get_started').popover('destroy');
				});
			}
		});

		$(".route_toggle").on("click", function() {

			var route_tag = $(this).attr("id").replace("routepicker_","");

			if ($(this).hasClass("selected")) {
				$(this).removeClass("selected");

				// turn off vehicle display
				hideVehicles(route_tag);
			} else {
				$(this).addClass("selected");

				// turn on vehicle display
				showVehicles(route_tag);
				$('#get_started').popover('destroy');
			}
			return false;
		});

		$(function () {
  			$('[data-toggle="popover"]').popover()
		});

		$('#get_started').popover('show');
	}

	/*
	* Toggle visibility of route markers and paths
	*
	*/
	function hideVehicles(route_tag) {

		routes[my_agency]['routes'][route_tag]['poll'] = false;

		// hide vehicle markers
		$(".route_"+route_tag).css({
			"visibility": "hidden"
		});
		// hide vehicle paths
		$(".route_path_"+route_tag).css({
			"visibility": "hidden"
		});
		// toggle selection button
		$("#routepicker_"+route_tag).css({
			"background-color": "#fff",
			"color": "black"
		});
	}
	function showVehicles(route_tag) {
		routes[my_agency]['routes'][route_tag]['poll'] = true;

		// show vehicle markers
		$(".route_"+route_tag).css({
			"visibility": "visible"
		});
		// show vehicle paths
		$(".route_path_"+route_tag).css({
			"visibility": "visible"
		});
		// toggle selection button
		$("#routepicker_"+route_tag).css({
			"background-color": "#" + routes[my_agency]['routes'][route_tag]['color'],
			"color": "#" + routes[my_agency]['routes'][route_tag]['oppositeColor']
		});
	}

	/*
	* Helper function that builds the transform property.
	* Called on zoom, pan and initial display.
	*/
	function build_vehicle_transform(lon, lat, lon_init, lat_init) {
		var t = "translate(" + (projection([lon, lat])[0] - projection([lon_init, lat_init])[0]) + "," + (projection([lon, lat])[1] - projection([lon_init, lat_init])[1]) + ")";
		return t;
	}

	/*
	* Logic to match the progress bar with our API call schedule
	* It gives the page some life, and helps the user get a sense 
	* for what is going on in the background
	*/
	function next_update_feedback() {
	    var t = 15;	        
	    var i = setInterval(function() {
		    $("#next_update").text("Next update in " + t + " seconds");
		    $(function() {
			    $( "#progressbar" ).progressbar({
			      value: (t * 100 / 15)
			    });
			  });
		    t -= 1;
		    if (t == 0) {
		        clearInterval(i);
		        return
		    }
		}, 1000);
	}
});


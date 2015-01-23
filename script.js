
// For pereventing callback hell
// and ordering layers properly
// probably use PROMISES
// http://tech.pro/blog/1402/five-patterns-to-help-you-tame-asynchronous-javascript
// 		check out FSMs too.



$(document).ready(function() {

	var w = $(window).width(),
	    h = $(window).height(),
	    routes = {},
	    city = {
	    	lon: 122.4417686,
	    	lat: 37.7682044
	    };

	var lightrail_routes = ['F', 'J', 'KT', 'L', 'M', 'N', 'S'];
	var projection = d3.geo.albers() 
	      .translate([w*3/8, h/2]) 
	      .scale(270000) 
	      .rotate([city.lon, 0]) 
	      .center([0, city.lat]); 

	var path = d3.geo.path().projection(projection);

	var zoom = d3.behavior.zoom()
		.translate(projection.translate())
		.scale(projection.scale())
		.scaleExtent([270000,4000000])
		.on("zoom", function() {
			projection.translate(d3.event.translate).scale(d3.event.scale);
			//svg.selectAll(".svg_nbhd").attr("d", path);
			svg.selectAll(".maplayer").attr("d", path);
			
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
	
	
	svg_load_paths("sfmaps/freeways.json", 		"maplayer svg_freeway hide");
	svg_load_paths("sfmaps/arteries.json", 		"maplayer svg_artery hide");
	svg_load_paths("sfmaps/streets.json", 		"maplayer svg_street");
	svg_load_paths("sfmaps/neighborhoods.json", "maplayer svg_nbhd hide");
	

	my_agency = "sf-muni";

	fetchRoutesForAgency(my_agency);
	setTimeout(registerListeners, 2000);	
	setInterval(pollSelected, 15000);
	setInterval(refreshDisplay, 1000);

	/*
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

	function fetchRouteConfig(agency_tag, route_tag) {
		queryString = "http://webservices.nextbus.com/service/publicXMLFeed?command=routeConfig&a=" + agency_tag + "&r=" + route_tag + "&terse";
		var retry = 0;

		do {
			d3.xml(queryString, function(error, xml) {
				if (error) { retry = 1; return; }
				
				var json = $.xml2json(xml);
				routes[agency_tag]['routes'][route_tag] = json.route;
				routes[agency_tag]['routes'][route_tag]['last_time'] = 0;
				routes[agency_tag]['routes'][route_tag]['poll'] = false;
				var rp_button = "<div id='routepicker_" + route_tag + "' class='route_toggle'>" + route_tag + "</div>";
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
	*  agency_tag - unique identifier used by nextbus to denote transit agencies
	*  route_tag    - alphanumeric ID of the route
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

	function pollAllRoutes(agency_tag) {
		$.each(routes[agency_tag]['routes'], function(i,d) {
			pollVehicleLocationsForRoute(agency_tag, d.tag);
		});
	}

	function pollAllMuni() {
		pollAllRoutes("sf-muni");
	}

	function pollSelected() {

		$.each(routes[my_agency]['routes'], function(i,d) {
			if (d['poll']) {
				pollVehicleLocationsForRoute(my_agency, d.tag);
			}
		});
	}
	function refreshDisplay() {
		$.each(routes[my_agency]['routes'], function(i,d) {
				displayVehiclesForRoute(my_agency, d.tag);
		});
	}


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

		    .attr("cx", function(d) {
	            return projection([d.lon, d.lat])[0];
	        })
	        .attr("cy", function(d) {
	            return projection([d.lon, d.lat])[1];
	        })*/

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
		    	.attr("fill", "#" + routes[agency_tag]['routes'][route_tag]['color']);

		vehicles.exit().remove();
	    	//.attr("fill-opacity", ".7");
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
					hideVehicle(d.tag);
				});

			} else {
				$(this).addClass("selected");
				$(this).text('None');
				$(".route_toggle").addClass("selected");
				$.each(routes[my_agency]['routes'], function(i,d) {
					showVehicle(d.tag);
				});
			}
		});

		$(".route_toggle").on("click", function() {

			var route_tag = $(this).attr("id").replace("routepicker_","");
			console.log("toggled route: ", route_tag);	

			if ($(this).hasClass("selected")) {
				$(this).removeClass("selected");

				// turn off vehicle display
				hideVehicle(route_tag);
			} else {
				$(this).addClass("selected");

				// turn on vehicle display
				showVehicle(route_tag);
			}
			return false;
		});
	}

	function hideVehicle(route_tag) {

		routes[my_agency]['routes'][route_tag]['poll'] = false;

			$(".route_"+route_tag).css({
				"visibility": "hidden"
			});

			$("#routepicker_"+route_tag).css({
				"background-color": "#fff",
				"color": "black"
			});
	}
	function showVehicle(route_tag) {
		routes[my_agency]['routes'][route_tag]['poll'] = true;

			$(".route_"+route_tag).css({
				"visibility": "visible"
			});

			$("#routepicker_"+route_tag).css({
				"background-color": "#" + routes[my_agency]['routes'][route_tag]['color'],
				"color": "#" + routes[my_agency]['routes'][route_tag]['oppositeColor']
			});
	}

	function build_vehicle_transform(lon, lat, lon_init, lat_init) {
		var t = "translate(" + (projection([lon, lat])[0] - projection([lon_init, lat_init])[0]) + "," + (projection([lon, lat])[1] - projection([lon_init, lat_init])[1]) + ")";
		return t;
	}


});
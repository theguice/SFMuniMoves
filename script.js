
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
			svg.selectAll(".svg_nbhd").attr("d", path);
			svg.selectAll("circle.vehicle").attr("cx", function(d) {
			    return projection([d.lon, d.lat])[0];
			});
			svg.selectAll("circle.vehicle").attr("cy", function(d) {
			    return projection([d.lon, d.lat])[1];
			});

	});



	var svg = d3.select("#map").insert("svg").attr("width", w*3/4).attr("height", h);
	svg.call(zoom);
	/*
		fetch all routes and populate this array
		add a boolean for currently displaying
		add a field for lastTime fetched
	*/
	
	
	
	svg_load_paths("sfmaps/neighborhoods.json", "svg_nbhd");
	//svg_load_paths("sfmaps/freeways.json", 		"svg_freeway");
	//svg_load_paths("sfmaps/arteries.json", 		"svg_artery");
	//svg_load_paths("sfmaps/streets.json", 		"svg_street");
	

	my_agency = "sf-muni";
	fetchRoutesForAgency(my_agency);

	setTimeout(registerListeners, 3000);
	//setInterval(pollAllMuni, 15000);
	setInterval(pollSelected, 15000);

	/*
	*
	* agency_tag - unique identifier used by nextbus to denote transit agencies
	*/
	function fetchRoutesForAgency(agency_tag) {
		var queryString = "http://webservices.nextbus.com/service/publicXMLFeed?command=routeList&a=" + agency_tag;

		// initialize this agency object in datastore
		routes[agency_tag] = {};
		routes[agency_tag]['routes'] = {}
		
		d3.xml(queryString, function(xml) {
			// Save list of routes as JSON object
			var json = $.xml2json(xml);

			$.each(json['route'], function(i,d) {
				fetchRouteConfig(agency_tag, d.tag);
			});
		});
	}

	function fetchRouteConfig(agency_tag, route_tag) {
		queryString = "http://webservices.nextbus.com/service/publicXMLFeed?command=routeConfig&a=" + agency_tag + "&r=" + route_tag + "&terse";

		d3.xml(queryString, function(xml) {
			var json = $.xml2json(xml);

			routes[agency_tag]['routes'][route_tag] = json.route;
			routes[agency_tag]['routes'][route_tag]['last_time'] = 0;
			routes[agency_tag]['routes'][route_tag]['poll'] = false;

			$("#route_picker").append("<div id='route-" + route_tag + "' class='route_toggle'>" + route_tag + "</div>");

			pollVehicleLocationsForRoute(my_agency, route_tag);
			//buildRoutePicker(routes[agency_tag]['routes']);
		});

	}

	/*
	*  agency_tag - unique identifier used by nextbus to denote transit agencies
	*  route_tag    - alphanumeric ID of the route
	*/
	function pollVehicleLocationsForRoute(agency_tag, route_tag) {

		var queryString = "http://webservices.nextbus.com/service/publicXMLFeed?command=vehicleLocations&a=" + agency_tag + "&r=" + route_tag + "&t=" + routes[agency_tag]['routes'][route_tag]['last_time'];

		d3.xml(queryString, function(xml) {
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
							vehicles[j] = json.vehicle[i];
							isnew = false;
							break;
						} else {
							continue;
						}
					}
					// if no match, append the new vehicle
					if (isnew) {
						routes[agency_tag]['routes'][route_tag]['vehicles'].push(json.vehicle[i]);
					}
				}
			}

			displayVehiclesForRoute(my_agency, route_tag);
		});
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

	function displayVehiclesForRoute(agency_tag, route_tag) {

		//console.log("DISPLAY ROUTE", routes[agency_tag]['routes'][route_tag]);

		var vehicleGroup = svg.append('g')
			  	.attr("id", function(d) {
					return "vehiclegroup-" + route_tag;
			  	})
			  	.attr("visibility", function(){
			  		if (routes[agency_tag]['routes'][route_tag]['poll']) {
			  			return "visible";
			  		} else {
			  			return "hidden";
			  		}
			  	});


		
		var vehicles = vehicleGroup.selectAll("circle")
		    .data(routes[agency_tag]['routes'][route_tag]['vehicles']);


		/*
		vehicles
		  .transition()
			.attr("transform", function(d) {
				console.log("D", d);
				var t = "translate(" + projection([d.lon, d.lat])[0] + "," + projection([d.lon, d.lat])[1] + ")";
				console.log("TRANSFORM", t)
				return t;
			});
		*/

		/*
			.attr("cx", function(d) {
	            return projection([d.lon, d.lat])[0];
	        })
	        .attr("cy", function(d) {
	            return projection([d.lon, d.lat])[1];
	        }); */

	    // add any new vehicles
		vehicles.enter()
		  	  .append("circle")
		  	  	.attr("id", function(d) {
		  	  		//console.log("D", d);

					return "vehicle_" + d.id;
			  	})
		    	.attr("cx", function(d) {
		            return projection([d.lon, d.lat])[0];
		        })
		        .attr("cy", function(d) {
		            return projection([d.lon, d.lat])[1];
		        })
		    	.attr("r", 2)
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
		$(".route_toggle").on("click", function() {

			var route_tag = $(this).attr("id").replace("route-","");
			console.log("toggled route: ", route_tag);	

			if ($(this).hasClass("selected")) {
				$(this).removeClass("selected");

				// turn off vehicle display
				routes[my_agency]['routes'][route_tag]['poll'] = false;

				$("#vehiclegroup-"+route_tag).css({
					"visibility": "hidden"
				});

				$("#route-"+route_tag).css({
					"background-color": "#fff",
					"color": "black"
				});
				
			} else {
				$(this).addClass("selected");

				// turn on vehicle display
				routes[my_agency]['routes'][route_tag]['poll'] = true;

				$("#vehiclegroup-"+route_tag).css({
					"visibility": "visible"
				});

				$("#route-"+route_tag).css({
					"background-color": "#" + routes[my_agency]['routes'][route_tag]['color'],
					"color": "#" + routes[my_agency]['routes'][route_tag]['oppositeColor']
				});
			}
			return false;
		});
	}
/*
	function svg_load_polygons(json_src, html_class) {
		d3.json(json_src, function(d) {
	        svg.selectAll("path")
	           .data(d.features)
	           .enter()
	           .append("path")
	           .attr("d", path)
	           .attr("class", html_class);
		});
	}
*/

});
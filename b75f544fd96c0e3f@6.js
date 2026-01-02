function _1(md){return(
md`# 2026 CFP Roster Analysis`
)}

async function _dashboard(html,Plot,d3)
{
  // -----------------------------------------------------------
  // 1. SETUP & UTILITIES
  // -----------------------------------------------------------
  const apiKey = "lgPLUE0IFyfcTBJfXmE2qZOLoz99qbZ63/4eQBKrFO9SF22Q8jO3k7Y7E69ksRw0".trim();
  const seasonYear = 2024;
  
  // Official Team Colors
  const teamColors = {
    "Indiana": "#990000",       // Crimson
    "Ohio State": "#BB0000",    // Scarlet
    "Georgia": "#BA0C2F",       // Red
    "Texas Tech": "#CC0000",    // Scarlet
    "Oregon": "#154733",        // Green
    "Ole Miss": "#14213D",      // Navy Blue
    "Texas A&M": "#500000",     // Maroon
    "Oklahoma": "#841617",      // Crimson
    "Alabama": "#9E1B32",       // Crimson
    "Miami": "#005030",         // Dark Green
    "Tulane": "#006747",        // Olive Green
    "James Madison": "#450084"  // Purple
  };

  const cfpTeams = Object.keys(teamColors);

  // Metro Areas (Chicago, DMV, LA, etc)
  const metroAreas = [
    {city: "Los Angeles", lat: 34.05, lon: -118.24},
    {city: "Dallas", lat: 32.77, lon: -96.79},
    {city: "Houston", lat: 29.76, lon: -95.36},
    {city: "Atlanta", lat: 33.74, lon: -84.38},
    {city: "Tampa", lat: 27.95, lon: -82.45},
    {city: "Miami", lat: 25.76, lon: -80.19},
    {city: "Chicago", lat: 41.87, lon: -87.62},
    {city: "DMV", lat: 38.90, lon: -77.03} 
  ];

  // Campus Locations for Scorecard
  const locations = {
    "Indiana": {lat: 39.17, lon: -86.51}, "Ohio State": {lat: 40.00, lon: -83.03},
    "Georgia": {lat: 33.94, lon: -83.37}, "Texas Tech": {lat: 33.58, lon: -101.87},
    "Oregon": {lat: 44.04, lon: -123.07}, "Ole Miss": {lat: 34.36, lon: -89.53},
    "Texas A&M": {lat: 30.61, lon: -96.33}, "Oklahoma": {lat: 35.20, lon: -97.44},
    "Alabama": {lat: 33.20, lon: -87.56}, "Miami": {lat: 25.71, lon: -80.27},
    "Tulane": {lat: 29.94, lon: -90.12}, "James Madison": {lat: 38.43, lon: -78.86}
  };

  function getDistance(lat1, lon1, lat2, lon2) {
    const R = 3958.8; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2; 
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // -----------------------------------------------------------
  // 2. FETCH DATA (Runs once)
  // -----------------------------------------------------------
  const [topojson, us] = await Promise.all([
    import("https://cdn.skypack.dev/topojson-client"),
    fetch("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json").then(d => d.json())
  ]);

  const allPlayers = [];
  const recruitIdsToFind = new Set();
  
  for (const team of cfpTeams) {
    try {
      const res = await fetch(`https://api.collegefootballdata.com/roster?year=${seasonYear}&team=${encodeURIComponent(team)}`, {
        headers: { "Authorization": `Bearer ${apiKey}` }
      });
      if (res.ok) {
        const data = await res.json();
        const located = data.filter(d => d.homeLatitude && d.homeLongitude);
        located.forEach(p => { if(p.recruitIds?.[0]) recruitIdsToFind.add(p.recruitIds[0]); });
        allPlayers.push(...located);
      }
    } catch (e) {}
  }

  // Fetch Stars
  const recruitMap = new Map();
  for (const team of cfpTeams) {
    const promises = [2020, 2021, 2022, 2023, 2024, 2025].map(yr => 
        fetch(`https://api.collegefootballdata.com/recruiting/players?year=${yr}&team=${encodeURIComponent(team)}`, {
           headers: { "Authorization": `Bearer ${apiKey}` }
        }).then(r => r.ok ? r.json() : [])
    );
    (await Promise.all(promises)).flat().forEach(r => recruitMap.set(r.id.toString(), r.stars));
  }

  const rosterData = allPlayers.map(p => ({
    ...p, 
    stars: (p.recruitIds?.[0] && recruitMap.get(p.recruitIds[0].toString())) || 0 
  }));

  // -----------------------------------------------------------
  // 3. CREATE UI CONTROLS (Standard Font, No Emoji)
  // -----------------------------------------------------------
  
  const form = html`<form style="display: grid; gap: 10px; padding: 10px; background: #fff; border-bottom: 1px solid #ddd;">
    <div style="display: flex; gap: 15px; flex-wrap: wrap;">
       <label><b>Color By:</b> <select name="colorMode"><option value="Team">Team</option><option value="Stars">Stars</option></select></label>
       <label><b>Team:</b> <select name="team"><option>All Teams</option>${cfpTeams.sort().map(t => `<option>${t}</option>`)}</select></label>
       <label><b>Position:</b> <select name="position"><option>All Positions</option>${[...new Set(rosterData.map(d=>d.position))].sort().map(p => `<option>${p}</option>`)}</select></label>
    </div>
    <div style="display: flex; align-items: center; gap: 10px; border-top: 1px dashed #ccc; padding-top: 10px;">
       <b>Scorecard Radius:</b> <input type="range" name="radius" min="10" max="1000" step="10" value="250" style="flex-grow:1;">
       <span id="radiusLabel">250 mi</span>
    </div>
  </form>`;

  const container = html`<div style="border: 1px solid #ccc; border-radius: 8px; overflow: hidden; max-width: 950px;">
    ${form}
    <div id="viz" style="padding: 10px;"></div>
  </div>`;

  // -----------------------------------------------------------
  // 4. RENDER FUNCTION
  // -----------------------------------------------------------
  function update() {
    const filters = {
      colorMode: form.colorMode.value,
      team: form.team.value,
      position: form.position.value,
      radius: +form.radius.value
    };
    form.querySelector("#radiusLabel").textContent = `${filters.radius} mi`;

    // Filter Data
    const filtered = rosterData.filter(d => 
      (filters.team === "All Teams" || d.team === filters.team) && 
      (filters.position === "All Positions" || d.position === filters.position)
    );

    // --- CHART 1: MAP ---
    const isStarMode = filters.colorMode === "Stars";
    const starColors = { 5: "#D4AF37", 4: "#3b82f6", 3: "#22c55e", 2: "#a3a3a3", 1: "#a3a3a3", 0: "#e5e5e5" };

    const map = Plot.plot({
      projection: "albers-usa", width: 920, height: 550,
      // Removed font-family override here
      marks: [
        Plot.geo(topojson.feature(us, us.objects.states), {fill: "#f3f3f3", stroke: "white"}),
        
        // Metro Labels (Moved Up & Darker)
        Plot.text(metroAreas, {
            x: "lon", y: "lat", 
            text: "city", 
            dy: -18, // Moved higher
            fill: "black", // Pure black
            stroke: "white", strokeWidth: 3, 
            fontSize: 11, fontWeight: "bold"
        }),
        Plot.dot(metroAreas, {x: "lon", y: "lat", r: 2, fill: "black"}),
        
        // Players
        Plot.dot(filtered, {
          x: "homeLongitude", y: "homeLatitude",
          fill: d => isStarMode ? (starColors[d.stars] || "#e5e5e5") : (teamColors[d.team] || "#ccc"),
          sort: isStarMode ? "stars" : null,
          r: 2.5, stroke: "white", strokeWidth: 0.2, opacity: 0.9,
          
          // HOVER TOOLTIP (Browser default)
          title: d => `${d.firstName} ${d.lastName}\n${d.homeCity}, ${d.homeState}\n${d.position} | ${d.stars ? d.stars + "★" : "NR"}`,
        }),
        
        // FANCY HOVER CARD
        Plot.tip(filtered, Plot.pointer({
            x: "homeLongitude", y: "homeLatitude", 
            title: d => `${d.firstName} ${d.lastName}\n${d.homeCity}, ${d.homeState}\n${d.position} • ${d.stars ? d.stars + "★" : "NR"}`
        }))
      ],
      color: { 
        legend: true, 
        domain: isStarMode ? [5, 4, 3, 2, 0] : cfpTeams,
        range: isStarMode ? ["#D4AF37", "#3b82f6", "#22c55e", "#a3a3a3", "#e5e5e5"] : cfpTeams.map(t => teamColors[t]),
        width: 900
      }
    });

    // --- CHART 2: SCORECARD ---
    const scoredTeams = [];
    for (const [teamName, players] of d3.group(rosterData, d => d.team)) {
      if (!locations[teamName]) continue;
      const campus = locations[teamName];
      const locals = players.filter(p => getDistance(p.homeLatitude, p.homeLongitude, campus.lat, campus.lon) <= filters.radius).length;
      scoredTeams.push({ team: teamName, pct: (locals / players.length) * 100 });
    }

    const scorecard = Plot.plot({
      height: 300, width: 920, marginLeft: 100,
      // Removed font-family override here
      x: {label: "% of Roster Local", domain: [0, 100], grid: true},
      y: {label: null},
      marks: [
        Plot.barX(scoredTeams, {
          x: "pct", y: "team", sort: {y: "x", reverse: true},
          fill: d => teamColors[d.team], tip: true
        }),
        Plot.text(scoredTeams, {
          x: "pct", y: "team", text: d => `${d.pct.toFixed(1)}%`, dx: 25, 
          fill: "black", fontSize: 11
        })
      ]
    });

    // Combine them
    const vizDiv = container.querySelector("#viz");
    vizDiv.innerHTML = "";
    vizDiv.appendChild(map);
    vizDiv.appendChild(document.createElement("hr"));
    vizDiv.appendChild(scorecard);
  }

  // Hook up events
  form.oninput = update;
  update(); // Initial run
  
  return container;
}


export default function define(runtime, observer) {
  const main = runtime.module();
  main.variable(observer()).define(["md"], _1);
  main.variable(observer("viewof dashboard")).define("viewof dashboard", ["html","Plot","d3"], _dashboard);
  main.variable(observer("dashboard")).define("dashboard", ["Generators", "viewof dashboard"], (G, _) => G.input(_));
  return main;
}

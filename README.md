# Been Here

A fog of war map for iPhone. The world starts covered in fog and clears
wherever you go. It runs as a web app you add to your Home Screen, so it
needs no App Store and no Mac to install.

## What it does

- Records your route with GPS while the app is open and clears the fog.
- Draw old trips with the pencil, or erase mistakes.
- Imports GPX, KML, GeoJSON, Google Maps Timeline exports and photo locations.
- Stats: share of the world explored, countries, continents, towns and
  cities, city districts, and how much you cleared this week and month.
- Places: looks up the district, city and region around you on
  OpenStreetMap and shows how much of each you have explored. Save areas
  and set goals.
- Shares a picture of your map.
- Works offline once installed. Your data stays on your phone. Save a
  backup now and then from Settings.

## Install on iPhone

1. Open the app's web address in Safari.
2. Tap Share, then Add to Home Screen.
3. Open it from the Home Screen and allow location when asked.

iPhone pauses web apps in the background, so recording only works while
the app is open. Turn on "Keep the screen on" in Settings for walks, and
import your Google Maps Timeline to fill in the rest.

## Develop

No build step. Python 3 only.

    python3 tools/serve.py          # http://localhost:8797, caching off
    python3 tools/build_data.py     # rebuild js/data from Natural Earth and GeoNames
    python3 tools/make_icons.py     # redraw the icons

Bump `VERSION` in `sw.js` whenever you change app files, or installed
copies keep the old version.

## How it works

The world is split into Web Mercator cells at zoom 18 (about 95 m in
London). Each visited cell is stored as a number in IndexedDB, saved in
regional chunks. The fog is a canvas layer that cuts a soft hole for each
visited cell, using coarser cells when zoomed out.

## Credits

Map tiles by Esri. Country shapes from Natural Earth (public domain).
Towns and cities from GeoNames (CC BY 4.0). Area outlines from
OpenStreetMap contributors via Nominatim. Map library Leaflet.

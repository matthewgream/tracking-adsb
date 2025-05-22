#!/usr/bin/env python3

import json
import sys
import math


def haversine(lat1, lon1, lat2, lon2):
    R = 6371  # Earth radius in kilometers
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = math.sin(dLat / 2) * math.sin(dLat / 2) + math.cos(
        math.radians(lat1)
    ) * math.cos(math.radians(lat2)) * math.sin(dLon / 2) * math.sin(dLon / 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def main():
    if len(sys.argv) != 4:
        print("Usage: python script.py latitude longitude distance_km")
        sys.exit(1)

    center_lat = float(sys.argv[1])
    center_lon = float(sys.argv[2])
    radius_km = float(sys.argv[3])

    with open("airports.json", "r") as f:
        airports = json.load(f)

    result = {}
    for code, airport in airports.items():
        try:
            distance = haversine(center_lat, center_lon, float(airport["lat"]), float(airport["lon"]))

            if distance <= radius_km:
                result[code] = airport
        except (KeyError, ValueError):
            continue

    print(json.dumps(result, indent=4))


if __name__ == "__main__":
    main()

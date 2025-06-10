// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

// International Standard Atmosphere (ISA) calculations
const ISA = {
    seaLevelTemp: 15, // °C
    seaLevelPressure: 1013.25, // hPa
    temperatureLapseRate: 1.98, // °C per 1000ft (6.5°C per 1000m)
    tropopauseAlt: 36089, // ft

    getTemperature(altitudeFt) {
        if (altitudeFt <= this.tropopauseAlt) {
            return this.seaLevelTemp - (altitudeFt / 1000) * this.temperatureLapseRate;
        }
        // Above tropopause, temperature is constant
        return -56.5; // °C
    },

    getPressure(altitudeFt) {
        // Simplified pressure calculation
        const altitudeM = altitudeFt * 0.3048;
        return this.seaLevelPressure * (1 - (0.0065 * altitudeM) / 288.15) ** 5.255;
    },

    getDensityAltitude(pressureAlt, oat) {
        const stdTemp = this.getTemperature(pressureAlt);
        const tempDeviation = oat - stdTemp;
        // Approximate: 120ft per degree C
        return pressureAlt + tempDeviation * 120;
    },

    getMachNumber(tas, oat) {
        // Speed of sound = 38.94 * sqrt(oat + 273.15)
        const speedOfSound = 38.94 * Math.sqrt(oat + 273.15);
        return tas / speedOfSound;
    },
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = {
    ISA,
};

// ------------------------------------------------------------------------------------------------------------------------------------------------------------
// ------------------------------------------------------------------------------------------------------------------------------------------------------------

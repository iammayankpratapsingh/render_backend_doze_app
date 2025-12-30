const mongoose = require("mongoose");

const HealthDataSchema = new mongoose.Schema({
    deviceId: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    
    // Full name fields - stored as top-level fields (all as Number)
    timestampSeconds: { type: Number },
    timestampMilliseconds: { type: Number },
    temperature: { type: Number },
    humidity: { type: Number },
    motionStart: { type: Number },
    motionEndReason: { type: Number },
    absenceStart: { type: Number },
    absenceEnd: { type: Number },
    snoringStart: { type: Number },
    snoringStop: { type: Number },
    snoringFrequency: { type: Number },
    respirationStop: { type: Number },
    respirationStart: { type: Number },
    voltage: { type: Number },
    level: { type: Number },
    status: { type: Number },
    heartRate: { type: Number },
    respiration: { type: Number },
    pm10: { type: Number },
    co2: { type: Number },
    voc: { type: Number },
    etoh: { type: Number },
    
    metrics: {
        nn50: { type: Number },
        sdsd: { type: Number },
        mxdmn: { type: Number },
        mo: { type: Number },
        amo: { type: Number },
        stress_ind: { type: Number },
        lf_pow: { type: Number },
        hf_pow: { type: Number },
        lf_hf_ratio: { type: Number },
        bat: { type: Number },
        mean_hr: { type: Number },
        snore_num: { type: Number },
        snore_freq: { type: Number },
        pressure: { type: Number },
        bvoc: { type: Number },
        co2: { type: Number },
        gas_percent: { type: Number },

        HRrest: { type: Number },
        HRmax: { type: Number },
        VO2max: { type: Number },
        LactateThres: { type: Number },
        TemperatureSkin: { type: Number },
        TemperatureEnv: { type: Number },
        TemperatureCore: { type: Number },
        ECG: { type: Number },
        Barometer: { type: Number },
        Accel: { type: Number },
        Gyro: { type: Number },
        Magneto: { type: Number },
        Steps: { type: Number },
        Calories: { type: Number },
        Distance: { type: Number },
        BloodPressureSys: { type: Number },
        BloodPressureDia: { type: Number },
        MuscleOxygenation: { type: Number },
        GSR: { type: Number },
        SleepStage: { type: Number },
        SleepQuality: { type: Number },
        PostureFront: { type: Number },
        PostureSide: { type: Number },
        Fall: { type: Number },
        BMI: { type: Number },
        BodyIndex: { type: Number },
        ABSI: { type: Number },
        Sports: { type: Number },
        Start: { type: Number },
        End: { type: Number },
        NormalSinusRhythm: { type: Number },
        CHFAnalysis: { type: Number },
        Diabetes: { type: Number },
        TMT: { type: Number },
        sdnn: { type: Number },
        rmssd: { type: Number },
        pnn50: { type: Number },
        hr_median: { type: Number },
        rr_tri_index: { type: Number },
        tin_rmssd: { type: Number },
        sd1: { type: Number },
        sd2: { type: Number },
        lf: { type: Number },
        hf: { type: Number },
        lfhf: { type: Number },
        sample_entropy: { type: Number },
        sd1sd2: { type: Number },
        sns_index: { type: Number },
        pns_index: { type: Number }
    },
    signals: {
        motion: { type: Number },
        presence: { type: Number },
        activity: { type: Number },
        battery: { type: Number },
        mic: { type: Number },
        rrIntervals: [{ type: Number }],
        rawWaveform: [{ type: Number }]
    },

    // ✅ Raw storage for debugging/logging UART packets
    raw: {
        type: Object,  // catch-all raw UART JSON payload
        default: {}
    }

}, {
    strict: true,  // Prevent saving fields not defined in schema
    collection: 'healthdata_new'  // Use custom collection name
});

// Note: Fields are now stored with full names (temperature, heartRate, etc.)

HealthDataSchema.index({ deviceId: 1, timestamp: -1 });
// Unique index to prevent duplicates based on deviceId + timestampSeconds
HealthDataSchema.index({ deviceId: 1, timestampSeconds: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("HealthData", HealthDataSchema);

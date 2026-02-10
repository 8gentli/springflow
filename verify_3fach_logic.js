
const assert = require('assert');

// Mocking simulations state and config
const simConfig = {
    logic: "RR",
    ppm: 55, // New Default
    minCap: 5,
    maxCap: 10, // New Default
    probGlobal: 4, // New Default
    pathSpeed: 3,
    speed: 1
};

const UNIT_SPACING = 11; // DOT_RADIUS * 2 + 3
const END_X = 820;
const SOURCE_X = 50;
const SENSOR_TIMEOUT = 500;

let simState = {
    elapsedSimTime: 0,
    sourceStops: 0,
    sourceState: 'IDLE',
    lastSourceTime: 0,
    lastDistributedId: 0,
    paths: Array.from({ length: 3 }, (_, i) => ({
        id: i,
        units: [],
        requestMaterial: true,
        requestStartTime: 0,
        minActive: false,
        maxActive: false
    })),
    unitsSinceRestart: 0, // Critical for Empty Nest test
    activeTargetId: -1,
    pendingAfterStop: 0,
    lastActivePathId: 0,
    lockStartTime: 0,
    restartStartTime: 0
};

function runSimulationStep(s, c, dt) {
    s.elapsedSimTime += dt;
    const now = s.elapsedSimTime;

    // Sender Logic (Simplified for test)
    const msPerUnit = (60000 / c.ppm);
    if (now - s.lastSourceTime > msPerUnit) {
        let tid = -1;
        // RR Logic
        for (let i = 1; i <= 3; i++) {
            let checkId = (s.lastDistributedId + i) % 3;
            if (s.paths[checkId].requestMaterial) { tid = checkId; break; }
        }

        if (s.sourceState === 'ACTIVE' && tid !== -1) {
            s.unitsSinceRestart++;
            if (s.unitsSinceRestart === 8) {
                // 8. Einheit fehlt (Empty Nest)
                s.lastSourceTime = now;
                console.log(`[${now.toFixed(0)}] Empty Nest encountered (Unit 8 skipped)`);
            } else {
                s.paths[tid].units.push({ pos: SOURCE_X });
                s.lastDistributedId = tid;
                s.lastSourceTime = now;
                console.log(`[${now.toFixed(0)}] Unit sent to Path ${tid}`);
            }
        }
        // ... (Buffer Stop logic omitted for this specific test unless needed)
    }

    // Min/Max Sensor Logic (Ported extraction)
    s.paths.forEach(p => {
        const minX = END_X - (c.minCap - 0.5) * UNIT_SPACING;
        const maxX = END_X - (c.maxCap - 0.5) * UNIT_SPACING;

        // Mock units moving to end
        p.units.forEach(u => u.pos += c.pathSpeed * (dt / 16.67));

        const isMinOccupied = p.units.some(u => Math.abs(u.pos - minX) < UNIT_SPACING * 0.6);
        const isMaxOccupied = p.units.some(u => Math.abs(u.pos - maxX) < UNIT_SPACING * 0.6);

        // Logic under test
        if (isMinOccupied) {
            if (p.minSensorTimer === 0) p.minSensorTimer = now;
        } else { p.minSensorTimer = 0; p.minActive = false; }

        if (isMaxOccupied) {
            if (p.maxSensorTimer === 0) p.maxSensorTimer = now;
            if (now - p.maxSensorTimer > SENSOR_TIMEOUT) p.maxActive = true;
        } else { p.maxSensorTimer = 0; p.maxActive = false; }
    });
}

// TEST 1: Empty Nest Logic
console.log("TEST 1: Empty Nest Logic (Skip 8th unit)");
simState.sourceState = 'ACTIVE';
simState.unitsSinceRestart = 0;

// Run for enough time to generate > 8 units
// PPM 55 => ~1090ms per unit. 9 units => ~10 seconds.
const dt = 16.67;
const duration = 12000;

let unitsCreated = 0;
// We need to spy on the push
const originalPush = Array.prototype.push;
// Reset paths
simState.paths.forEach(p => p.units = []);

// Track total units across all paths
let historyUnits = 0;
simState.paths.forEach(p => {
    p.units.push = function (...args) {
        historyUnits++;
        return Array.prototype.push.apply(this, args);
    }
});

for (let t = 0; t < duration; t += dt) {
    runSimulationStep(simState, simConfig, dt);
}

console.log(`Total units created in 12s: ${historyUnits}`);
// Expected: 1, 2, 3, 4, 5, 6, 7, (SKIP 8), 9, 10
// If no skip: ~11 units (12000/1090 = 11)
// With skip: 10 units?
// Let's check simState.unitsSinceRestart.
console.log(`Units since restart counter: ${simState.unitsSinceRestart}`);

if (simState.unitsSinceRestart >= 8 && historyUnits < simState.unitsSinceRestart) {
    console.log("PASS: Fewer units created than counter implies (Empty Nest worked)");
} else {
    console.log("FAIL: Empty Nest logic might be missing");
}


// TEST 2: Autonomous Sensor Logic
console.log("\nTEST 2: Autonomous Sensor Logic");
// Reset
simState.paths[0].units = [];
simState.paths[0].minActive = false;
simState.paths[0].maxActive = false;
// Add a unit exactly at Max Sensor position
const maxX = 820 - (10 - 0.5) * 11; // 820 - 9.5*11 = 820 - 104.5 = 715.5
simState.paths[0].units.push({ pos: maxX });

// Run for 600ms (timeout is 500ms)
for (let t = 0; t < 600; t += dt) {
    // Freeze unit position for this test to ensure it stays on sensor
    // (In real sim they might move, but if blocked they stay)
    // We override movement in runSimulationStep for this test or just let it move slowly?
    // Let's just manually set pos back to maxX every step to simulate blockage
    simState.paths[0].units[0].pos = maxX;

    runSimulationStep(simState, simConfig, dt);
}

if (simState.paths[0].maxActive) {
    console.log("PASS: Max Sensor activated autonomously");
} else {
    console.log("FAIL: Max Sensor did not activate");
}

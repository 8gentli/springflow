        const canvas = document.getElementById('simCanvas');
        const ctx = canvas.getContext('2d');

        const DOT_RADIUS = 4;
        const UNIT_SPACING = DOT_RADIUS * 2 + 3;
        const WEICHE_X = 180;
        const END_X = 820;
        const SOURCE_X = 50;
        const SENSOR_TIMEOUT = 500; // ms for sensor to become active

        let isRunning = true;
        let simState; // Renamed from 'state' to avoid conflict with global 'state'
        let statsHistory = [];
        let statsDurationMs = 60 * 1000; // Default 1 minute for stats calculation

        function init() {
            simState = {
                elapsedSimTime: 0,
                sourceStops: 0,
                sourceState: 'IDLE',
                lastSourceTime: 0,
                lockStartTime: 0,
                restartStartTime: 0,
                activeTargetId: -1,
                lastDistributedId: 0,
                pendingAfterStop: 0,
                lastActivePathId: 0,
                unitsSinceRestart: 0,
                globalDowntime: false,
                globalDowntimeUntil: 0,
                paths: Array.from({ length: 3 }, (_, i) => ({ // Auf 3 Pfade geaendert
                    id: i,
                    units: [],
                    isDown: false,
                    starvationTimer: 0,
                    lastTakeTime: 0,
                    missedUnits: 0,
                    processedUnits: 0,
                    y: 90 + i * 110, // Vertikaler Abstand angepasst
                    requestMaterial: true,
                    minSensorTimer: 0,
                    maxSensorTimer: 0,
                    minActive: false,
                    maxActive: false,
                    requestStartTime: 0,
                    // New fields for stats
                    downtimeStart: 0,
                    totalDowntime: 0,
                    waitingTimeStart: 0,
                    totalWaitingTime: 0,
                    lastUnitProcessedTime: 0,
                    lastUnitMissedTime: 0,
                    lastUnitSentTime: 0,
                    unitsSent: 0,
                    unitsAtMinSensor: 0,
                    unitsAtMaxSensor: 0,
                    lastMinSensorActive: false,
                    lastMaxSensorActive: false,
                }))
            };
            statsHistory = [];
            updateStatsDurationInput();
        }

        init();

        function toggleSim(val) { isRunning = val; }
        function resetSim() { init(); toggleSim(false); }

        const ui = (id) => document.getElementById(id);
        const simConfig = { // Renamed from 'config' to avoid conflict
            get logic() { return ui('logicMode').value; },
            get ppm() { return parseInt(ui('senderPpm').value); },
            get minCap() { return parseInt(ui('minCap').value); },
            get maxCap() { return parseInt(ui('maxCap').value); },
            get probGlobal() { return parseInt(ui('probGlobal').value); },
            get pathSpeed() { return parseFloat(ui('pathSpeed').value); },
            get speed() { return parseFloat(ui('simSpeed').value); }
        };

        ['senderPpm', 'pathSpeed', 'probGlobal', 'simSpeed', 'minCap', 'maxCap'].forEach(id => {
            ui(id).oninput = () => ui(id + 'Val').innerText = ui(id).value + (id.includes('prob') ? '%' : '');
        });

        ui('statsDuration').addEventListener('change', (e) => {
            const [minutes, seconds] = e.target.value.split(':').map(Number);
            if (!isNaN(minutes) && !isNaN(seconds) && minutes >= 0 && seconds >= 0 && seconds < 60) {
                statsDurationMs = (minutes * 60 + seconds) * 1000;
            } else {
                updateStatsDurationInput(); // Revert to current valid value
            }
        });

        function updateStatsDurationInput() {
            const totalSeconds = statsDurationMs / 1000;
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            ui('statsDuration').value = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }

        function adjustTime(deltaSeconds) {
            statsDurationMs = Math.max(0, statsDurationMs + deltaSeconds * 1000);
            updateStatsDurationInput();
        }

        function update() {
            if (!isRunning) return;
            let remainingDelta = 16.67 * simConfig.speed;
            const maxStep = 16.67;

            while (remainingDelta > 0) {
                const dt = Math.min(remainingDelta, maxStep);
                simulateStep(dt);
                remainingDelta -= dt;
            }
        }

        function simulateStep(dt) {
            runSimulationStep(simState, simConfig, dt);
        }

        function draw() {
            const now = simState.elapsedSimTime;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            simState.paths.forEach(p => {
                ctx.strokeStyle = p.requestMaterial ? 'rgba(0, 255, 0, 0.12)' : '#2a2a2a';
                ctx.lineWidth = 18; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.moveTo(SOURCE_X, 190); ctx.lineTo(WEICHE_X, p.y); ctx.lineTo(END_X, p.y); ctx.stroke();

                const minX = END_X - (simConfig.minCap - 0.5) * UNIT_SPACING;
                const maxX = END_X - (simConfig.maxCap - 0.5) * UNIT_SPACING;
                drawSensor(minX, p.y, "MIN", p.minActive);
                drawSensor(maxX, p.y, "MAX", p.maxActive);

                p.units.forEach(u => {
                    let drawY = u.pos < WEICHE_X ? 190 + (p.y - 190) * Math.max(0, (u.pos - SOURCE_X) / (WEICHE_X - SOURCE_X)) : p.y;
                    ctx.fillStyle = (u.isPurge && u.isMoving) ? '#ff9999' : '#ddd';
                    ctx.beginPath(); ctx.arc(u.pos, drawY, DOT_RADIUS, 0, Math.PI * 2); ctx.fill();
                });

                const blocked = simState.globalDowntime || p.isDown;
                const starved = p.starvationTimer > now;
                ctx.fillStyle = starved ? '#ffa500' : (blocked ? '#f00' : '#0f0');
                if (starved) { ctx.shadowBlur = 15; ctx.shadowColor = '#ffa500'; }
                ctx.beginPath(); ctx.arc(END_X + 25, p.y, 12, 0, Math.PI * 2); ctx.fill();
                ctx.shadowBlur = 0;

                ctx.font = 'bold 12px monospace';
                ctx.fillStyle = '#0f0';
                ctx.fillText(`OK:   ${p.processedUnits}`, END_X + 50, p.y - 5);
                ctx.fillStyle = '#f60';
                ctx.fillText(`MISS: ${p.missedUnits}`, END_X + 50, p.y + 10);
            });

            let sCol = (simState.sourceState === 'ACTIVE' || simState.sourceState === 'BUFFER_STOP') ? '#0f0' : (simState.sourceState === 'LOCKED' ? '#f00' : (simState.sourceState === 'RESTART' ? '#ff0' : '#444'));
            ctx.fillStyle = sCol; ctx.shadowBlur = (sCol !== '#444') ? 15 : 0; ctx.shadowColor = sCol;
            ctx.fillRect(SOURCE_X - 20, 170, 40, 40); ctx.shadowBlur = 0;
            ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial';
            ctx.fillText(simState.sourceState === 'ACTIVE' ? 'ACTIVE' : 'BUFFER STOP', SOURCE_X - 35, 165);

            const totalSecs = Math.floor(simState.elapsedSimTime / 1000);
            ui('globalStats').innerHTML = `Zeit: ${Math.floor(totalSecs / 60).toString().padStart(2, '0')}:${(totalSecs % 60).toString().padStart(2, '0')} | Winder-Stopps: ${simState.sourceStops}`;
        }

        function drawSensor(x, y, label, active) {
            ctx.fillStyle = active ? '#ff0' : '#444'; ctx.beginPath(); ctx.arc(x, y + 14, 3, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#777'; ctx.font = '7px Arial'; ctx.fillText(label, x - 6, y + 24);
        }

        function calculateStats() {
            const btn = document.querySelector('button[onclick="calculateStats()"]');
            const originalText = btn.innerText;
            btn.innerText = "Berechne...";
            btn.disabled = true;

            setTimeout(() => {
                const totalMinutes = statsDurationMs / 60000;

                // Snapshot current config
                const calcConfig = {
                    logic: simConfig.logic,
                    ppm: simConfig.ppm,
                    minCap: simConfig.minCap,
                    maxCap: simConfig.maxCap,
                    probGlobal: simConfig.probGlobal,
                    pathSpeed: simConfig.pathSpeed,
                    speed: 1
                };

                // Create simulation state FOR CALCULATION
                const calcState = {
                    elapsedSimTime: 0,
                    sourceStops: 0,
                    sourceState: 'IDLE',
                    lastSourceTime: 0,
                    lockStartTime: 0,
                    restartStartTime: 0,
                    activeTargetId: -1,
                    lastDistributedId: 0,
                    pendingAfterStop: 0,
                    lastActivePathId: 0,
                    unitsSinceRestart: 0,
                    globalDowntime: false,
                    globalDowntimeUntil: 0,
                    paths: Array.from({ length: 3 }, (_, i) => ({
                        id: i,
                        units: [],
                        isDown: false,
                        starvationTimer: 0,
                        lastTakeTime: 0,
                        missedUnits: 0,
                        processedUnits: 0,
                        y: 0,
                        requestMaterial: true,
                        minSensorTimer: 0,
                        maxSensorTimer: 0,
                        minActive: false,
                        maxActive: false,
                        requestStartTime: 0,
                        downtimeStart: 0,
                        totalDowntime: 0,
                        waitingTimeStart: 0,
                        totalWaitingTime: 0
                    }))
                };

                const dt = 16.67;
                const steps = Math.ceil(statsDurationMs / dt);

                for (let i = 0; i < steps; i++) {
                    runSimulationStep(calcState, calcConfig, dt);
                }

                const totalOK = calcState.paths.reduce((sum, p) => sum + p.processedUnits, 0);
                const totalMISS = calcState.paths.reduce((sum, p) => sum + p.missedUnits, 0);

                const displayHours = Math.floor(totalMinutes / 60);
                const displayMinutes = totalMinutes % 60;
                const timeDisplay = `${String(displayHours).padStart(2, '0')}:${String(displayMinutes).padStart(2, '0')}`;

                const tbody = document.getElementById('statsBody');
                if (tbody.children[0] && tbody.children[0].innerText.includes("Keine Daten")) {
                    tbody.innerHTML = "";
                }

                const row = document.createElement('tr');
                row.style.borderBottom = "1px solid #444";
                row.innerHTML = `
                    <td style="padding: 5px;">${timeDisplay}</td>
                    <td style="padding: 5px;">${calcState.sourceStops}</td>
                    <td style="padding: 5px; color: #0f0;">${totalOK}</td>
                    <td style="padding: 5px; color: #f60;">${totalMISS}</td>
                    <td style="padding: 5px; color: #aaa;">${calcConfig.logic}</td>
                    <td style="padding: 5px; color: #aaa;">${calcConfig.ppm}</td>
                    <td style="padding: 5px; color: #aaa;">${calcConfig.minCap}</td>
                    <td style="padding: 5px; color: #aaa;">${calcConfig.maxCap}</td>
                    <td style="padding: 5px; color: #aaa;">${calcConfig.probGlobal}%</td>
                    <td style="padding: 5px; color: #aaa;">${calcConfig.pathSpeed}</td>
                `;
                tbody.prepend(row);

                btn.innerText = originalText;
                btn.disabled = false;

            }, 50);
        }

        // Extracted simulation logic for both real-time and fast-forward
        function runSimulationStep(s, c, dt) {
            s.elapsedSimTime += dt;
            const now = s.elapsedSimTime;

            if (!s.globalDowntime && c.probGlobal > 0) {
                if (Math.random() < (0.0004 * (dt / 16.67) * (c.probGlobal / 20))) {
                    s.globalDowntime = true;
                    s.globalDowntimeUntil = now + 10000;
                }
            } else if (now > s.globalDowntimeUntil) {
                s.globalDowntime = false;
            }

            const cycleTime = 4700; // 4.7s fixed
            const isAnyPathDue = s.paths.some(p => now - p.lastTakeTime > cycleTime);

            if (isAnyPathDue) {
                const allReady = s.paths.every(p => p.units.length > 0 && p.units[0].pos >= END_X - DOT_RADIUS);

                s.paths.forEach(p => {
                    const isBlocked = s.globalDowntime;

                    if (!isBlocked) {
                        if (allReady) {
                            if (p.units.length > 0) p.units.shift();
                            p.processedUnits++;
                            p.isDown = false;
                            p.starvationTimer = 0;
                        } else {
                            p.missedUnits++;
                            p.starvationTimer = now + (cycleTime / 2);
                        }
                    } else {
                        p.isDown = true;
                        p.starvationTimer = 0;
                    }
                    p.lastTakeTime = now;
                });
            }

            s.paths.forEach(p => {
                for (let u of p.units) {
                    const targetPos = (p.units.indexOf(u) === 0) ? END_X : p.units[p.units.indexOf(u) - 1].pos - UNIT_SPACING;
                    if (u.pos < targetPos) {
                        u.pos += c.pathSpeed * (dt / 16.67);
                        u.isMoving = true;
                        if (u.pos >= targetPos) { u.pos = targetPos; u.isMoving = false; }
                    } else { u.isMoving = false; }
                }

                const minX = END_X - (c.minCap - 0.5) * UNIT_SPACING;
                const maxX = END_X - (c.maxCap - 0.5) * UNIT_SPACING;

                const isMinOccupied = p.units.some(u => Math.abs(u.pos - minX) < UNIT_SPACING * 0.6);
                const isMaxOccupied = p.units.some(u => Math.abs(u.pos - maxX) < UNIT_SPACING * 0.6);

                if (isMinOccupied) {
                    if (p.minSensorTimer === 0) p.minSensorTimer = now;
                    // if (now - p.minSensorTimer > SENSOR_TIMEOUT) p.minActive = true; // Wait for logic update
                } else { p.minSensorTimer = 0; p.minActive = false; }
                if (isMaxOccupied) {
                    if (p.maxSensorTimer === 0) p.maxSensorTimer = now;
                    if (now - p.maxSensorTimer > SENSOR_TIMEOUT) p.maxActive = true;
                } else { p.maxSensorTimer = 0; p.maxActive = false; }

                // Min Sensor Logic fix to match 4-fach
                // Actually 4-fach logic was:
                // if (isMinOccupied) { ... if > timeout p.minActive = true }
                // My previous edit in Weiche_3-fach had a syntax error in lines 477-479 (missing activation).
                if (isMinOccupied && now - p.minSensorTimer > SENSOR_TIMEOUT) p.minActive = true;

                const prevReq = p.requestMaterial;
                if (!p.minActive) p.requestMaterial = true;
                if (p.maxActive) p.requestMaterial = false;
                if (p.requestMaterial && !prevReq) p.requestStartTime = now;
                if (!p.requestMaterial) p.requestStartTime = 0;

                // Stats tracking
                if (p.isDown && p.downtimeStart === 0) p.downtimeStart = now;
                if (!p.isDown && p.downtimeStart !== 0) { p.totalDowntime += (now - p.downtimeStart); p.downtimeStart = 0; }
            });

            const anyReq = s.paths.some(p => p.requestMaterial);

            if (s.sourceState === 'ACTIVE' && !anyReq) {
                s.sourceState = 'BUFFER_STOP';
                s.pendingAfterStop = 3;
            } else if (s.sourceState === 'BUFFER_STOP' && s.pendingAfterStop <= 0) {
                s.sourceState = 'LOCKED';
                s.lockStartTime = now;
                s.sourceStops++;
            } else if (s.sourceState === 'LOCKED' && now - s.lockStartTime > 4000) {
                s.sourceState = 'IDLE';
            }

            if (s.sourceState === 'IDLE' && anyReq) {
                s.sourceState = 'RESTART';
                s.restartStartTime = now;
                s.unitsSinceRestart = 0;
            }

            if (s.sourceState === 'RESTART' && now - s.restartStartTime > 2000) {
                s.sourceState = anyReq ? 'ACTIVE' : 'IDLE';
            }

            const msPerUnit = (60000 / c.ppm);
            if (now - s.lastSourceTime > msPerUnit) {
                let tid = -1;
                if (c.logic === "Batch") {
                    if (s.activeTargetId !== -1 && !s.paths[s.activeTargetId].requestMaterial) s.activeTargetId = -1;
                    if (s.activeTargetId === -1 && anyReq) {
                        const reqPaths = s.paths.filter(p => p.requestMaterial && p.requestStartTime > 0);
                        if (reqPaths.length > 0) {
                            s.activeTargetId = reqPaths.sort((a, b) => a.requestStartTime - b.requestStartTime)[0].id;
                        } else {
                            s.activeTargetId = s.paths.find(p => p.requestMaterial).id;
                        }
                    }
                    tid = s.activeTargetId;
                } else {
                    for (let i = 1; i <= 3; i++) {
                        let checkId = (s.lastDistributedId + i) % 3;
                        if (s.paths[checkId].requestMaterial) { tid = checkId; break; }
                    }
                }

                if (s.sourceState === 'ACTIVE' && tid !== -1) {
                    s.unitsSinceRestart++;
                    if (s.unitsSinceRestart === 8) {
                        s.lastSourceTime = now;
                    } else {
                        s.paths[tid].units.push({ pos: SOURCE_X, isPurge: false });
                        s.lastDistributedId = tid; s.lastActivePathId = tid;
                        s.lastSourceTime = now;
                        if (c.logic === "RR") s.activeTargetId = -1;
                    }
                } else if (s.sourceState === 'BUFFER_STOP' && s.pendingAfterStop > 0) {
                    s.paths[s.lastActivePathId].units.push({ pos: SOURCE_X, isPurge: true });
                    s.pendingAfterStop--; s.lastSourceTime = now;
                }
            }
        }

        function frame() { update(); draw(); requestAnimationFrame(frame); }
        frame();

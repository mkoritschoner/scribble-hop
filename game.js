const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const connectBtn = document.getElementById('connectBtn');
const statusTxt = document.getElementById('status');

// UUIDs
const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const BTN_CHAR_UUID = "d601556a-127e-4689-9856-11f26a5c2d3a";
const IMU_CHAR_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
const BAT_CHAR_UUID = "0e82c815-46b0-4660-8480-161b203c9071";
const DISP_CHAR_UUID = "f6323862-23c3-424a-95f7-6799052d0b57";

// Game State
let gameState = {
    hp: 3,
    score: 0,
    tiltX: 0,
    battery: "Unknown",
    gameOver: false,
    posX: 200,
    posY: 400,
    playerVY: -15,
    platforms: [],
    spikes: [],
    hearts: [],
    invincibleUntil: 0,
    lastBleUpdate: 0,
    chars: {} // To store BLE characteristics
};

// --- BLE Logic ---
connectBtn.addEventListener('click', async () => {
    try {
        statusTxt.innerText = "Status: Scanning...";
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'M5-Scribble-Hop' }],
            optionalServices: [SERVICE_UUID]
        });

        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);

        // Map characteristics
        const uuids = [BTN_CHAR_UUID, IMU_CHAR_UUID, BAT_CHAR_UUID, DISP_CHAR_UUID];
        for (const uuid of uuids) {
            gameState.chars[uuid] = await service.getCharacteristic(uuid);
        }

        // Notifications
        await gameState.chars[BTN_CHAR_UUID].startNotifications();
        gameState.chars[BTN_CHAR_UUID].addEventListener('characteristicvaluechanged', handleBtn);

        await gameState.chars[IMU_CHAR_UUID].startNotifications();
        gameState.chars[IMU_CHAR_UUID].addEventListener('characteristicvaluechanged', handleIMU);

        await gameState.chars[BAT_CHAR_UUID].startNotifications();
        gameState.chars[BAT_CHAR_UUID].addEventListener('characteristicvaluechanged', handleBat);

        statusTxt.innerText = "Status: Connected!";
        connectBtn.disabled = true;
        resetGame();
        requestAnimationFrame(gameLoop);
    } catch (error) {
        console.error(error);
        statusTxt.innerText = "Status: Error - " + error.message;
    }
});

function handleBtn(event) {
    const val = new TextDecoder().decode(event.target.value);
    if (val === "A" && gameState.gameOver) resetGame();
}

function handleIMU(event) {
    const val = new TextDecoder().decode(event.target.value);
    const parts = val.split(',');
    if (parts.length > 1) {
        gameState.tiltX = parseFloat(parts[1]); // Y-axis for horizontal tilt
    }
}

function handleBat(event) {
    gameState.battery = new TextDecoder().decode(event.target.value);
}

async function updateM5Display() {
    const now = Date.now();
    if (now - gameState.lastBleUpdate > 150) { // Throttle
        let mode = gameState.gameOver ? "G" : (now < gameState.invincibleUntil ? "I" : "N");
        let displayStr = `${mode}|${gameState.hp}|${Math.floor(gameState.score)}`;
        
        try {
            await gameState.chars[DISP_CHAR_UUID].writeValue(new TextEncoder().encode(displayStr));
            gameState.lastBleUpdate = now;
        } catch (e) { /* Ignore transient write errors */ }
    }
}

// --- Game Logic ---
function resetGame() {
    gameState.hp = 3;
    gameState.score = 0;
    gameState.gameOver = false;
    gameState.posX = 200;
    gameState.posY = 400;
    gameState.playerVY = -20;
    gameState.platforms = [];
    gameState.spikes = [];
    gameState.hearts = [];
    for(let i=0; i<10; i++) {
        gameState.platforms.push({x: Math.random()*340, y: 600 - (i*60), w: 60, h: 10});
    }
}

let lastTime = 0;
function gameLoop(timestamp) {
    let dt = (timestamp - lastTime) / 1000;
    if (dt > 0.1) dt = 0.1;
    lastTime = timestamp;

    if (!gameState.gameOver) {
        updatePhysics(dt);
        updateM5Display();
    }
    
    draw();
    requestAnimationFrame(gameLoop);
}

function updatePhysics(dt) {
    // Horizontal movement
    gameState.posX += (gameState.tiltX * 500) * dt;
    // Gravity
    gameState.playerVY += 2500 * dt;
    gameState.posY += gameState.playerVY * dt;

    // Bounds
    if (gameState.posX < 0) gameState.posX = 0;
    if (gameState.posX > 370) gameState.posX = 370;

    // Collisions
    if (gameState.playerVY > 0) {
        gameState.platforms.forEach(p => {
            if (gameState.posX < p.x + p.w && gameState.posX + 30 > p.x &&
                gameState.posY + 30 > p.y && gameState.posY + 30 < p.y + 15) {
                gameState.playerVY = -1000;
                gameState.posY = p.y - 30;
            }
        });
    }

    // Scrolling
    if (gameState.posY < 200) {
        let diff = 200 - gameState.posY;
        gameState.posY = 200;
        gameState.score += diff / 10;
        gameState.platforms.forEach(p => p.y += diff);
        gameState.spikes.forEach(s => s.y += diff);
        gameState.hearts.forEach(h => h.y += diff);
    }

    // Recycling
    gameState.platforms.forEach(p => {
        if (p.y > 600) {
            p.y -= 600;
            p.x = Math.random() * 340;
            // Spawn items
            if (Math.random() < 0.1) gameState.spikes.push({x: p.x + 20, y: p.y - 20});
            if (Math.random() < 0.05) gameState.hearts.push({x: p.x + 20, y: p.y - 25});
        }
    });

    // Check Fail
    if (gameState.posY > 600 || gameState.hp <= 0) gameState.gameOver = true;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Platforms
    ctx.fillStyle = "#6464ff";
    gameState.platforms.forEach(p => ctx.fillRect(p.x, p.y, p.w, p.h));

    // Draw Spikes
    ctx.fillStyle = "#969696";
    gameState.spikes.forEach(s => {
        ctx.beginPath();
        ctx.moveTo(s.x, s.y + 20);
        ctx.lineTo(s.x + 20, s.y + 20);
        ctx.lineTo(s.x + 10, s.y);
        ctx.fill();
    });

    // Draw Player
    let flash = (Date.now() < gameState.invincibleUntil) && (Math.floor(Date.now()/100) % 2 === 0);
    if (!flash) {
        ctx.fillStyle = "#00ff64";
        ctx.fillRect(gameState.posX, gameState.posY, 30, 30);
    }

    // UI
    ctx.fillStyle = "white";
    ctx.font = "bold 30px Arial";
    ctx.fillText(`Score: ${Math.floor(gameState.score)}`, 20, 40);
    ctx.font = "20px Arial";
    ctx.fillStyle = "#ff6464";
    ctx.fillText(`HP: ${gameState.hp}`, 20, 70);
    ctx.fillStyle = "#00c8ff";
    ctx.fillText(`Bat: ${gameState.battery}%`, 20, 580);

    if (gameState.gameOver) {
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(0, 0, 400, 600);
        ctx.fillStyle = "yellow";
        ctx.font = "24px Arial";
        ctx.textAlign = "center";
        ctx.fillText("GAME OVER", 200, 280);
        ctx.fillText("Press Button A to Restart", 200, 320);
        ctx.textAlign = "left";
    }
}

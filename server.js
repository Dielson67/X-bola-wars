const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingInterval: 25000,
  pingTimeout: 20000
});

const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true, service: "x-ou-bola" }));

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[crypto.randomInt(chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function winner(cells) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of lines) {
    if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) return cells[a];
  }
  return null;
}

function publicState(room) {
  return {
    code: room.code,
    cells: room.cells,
    turn: room.turn,
    winner: room.winner,
    draw: room.draw,
    players: { X: Boolean(room.players.X), O: Boolean(room.players.O) },
    status: room.players.X && room.players.O ? "ready" : "waiting"
  };
}

function emitState(room) {
  io.to(room.code).emit("state", publicState(room));
}

io.on("connection", socket => {
  socket.on("createRoom", (ack = () => {}) => {
    const code = makeCode();
    const room = {
      code, cells: Array(9).fill(null), turn: "X", winner: null, draw: false,
      players: { X: socket.id, O: null }
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.room = code;
    socket.data.mark = "X";
    ack({ ok: true, code, mark: "X" });
    emitState(room);
  });

  socket.on("joinRoom", (rawCode, ack = () => {}) => {
    const code = String(rawCode || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!/^[A-Z2-9]{6}$/.test(code) || !room) return ack({ ok: false, error: "Sala não encontrada. Confirma o código." });
    if (room.players.O) return ack({ ok: false, error: "Esta sala já tem dois jogadores." });
    if (room.players.X === socket.id) return ack({ ok: false, error: "Já estás nesta sala." });

    room.players.O = socket.id;
    socket.join(code);
    socket.data.room = code;
    socket.data.mark = "O";
    ack({ ok: true, code, mark: "O" });
    emitState(room);
  });

  socket.on("play", (index, ack = () => {}) => {
    const code = socket.data.room;
    const mark = socket.data.mark;
    const room = rooms.get(code);
    if (!room || !mark || !Number.isInteger(index) || index < 0 || index > 8)
      return ack({ ok: false, error: "Jogada inválida." });
    if (!room.players.X || !room.players.O)
      return ack({ ok: false, error: "Ainda falta um jogador." });
    if (room.turn !== mark || room.cells[index] || room.winner || room.draw)
      return ack({ ok: false, error: "Não podes jogar nesta casa agora." });

    room.cells[index] = mark;
    room.winner = winner(room.cells);
    room.draw = !room.winner && room.cells.every(Boolean);
    room.turn = mark === "X" ? "O" : "X";
    ack({ ok: true });
    emitState(room);
  });

  socket.on("restart", (ack = () => {}) => {
    const room = rooms.get(socket.data.room);
    if (!room || !socket.data.mark) return ack({ ok: false, error: "Não estás numa sala." });
    if (!room.players.X || !room.players.O) return ack({ ok: false, error: "É preciso ter dois jogadores." });
    room.cells = Array(9).fill(null);
    room.turn = "X";
    room.winner = null;
    room.draw = false;
    ack({ ok: true });
    emitState(room);
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    const mark = socket.data.mark;
    const room = rooms.get(code);
    if (!room || !mark || room.players[mark] !== socket.id) return;
    room.players[mark] = null;
    if (!room.players.X && !room.players.O) {
      rooms.delete(code);
    } else {
      // A sala permanece disponível, mas uma partida só continua com ambos ligados.
      emitState(room);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`X ou Bola activo em http://localhost:${PORT}`);
});

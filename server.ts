import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import path from "path";

const SERVER_ID = Math.random().toString(36).substring(2, 7).toUpperCase();

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  const PORT = 3000;

  console.log(`Server ${SERVER_ID} starting...`);

  // Room state: Map<roomCode, { clients: Set<WebSocket>, theme: string, name?: string }>
  const rooms = new Map<string, { clients: Set<WebSocket>, theme: string, name?: string }>();

  wss.on("connection", (ws) => {
    let currentRoom: string | null = null;
    let currentUsername: string | null = null;

    console.log(`[${SERVER_ID}] New connection established`);

    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === "ping") return;

        if (message.type === "join") {
          const { roomCode, username } = message;
          const rCode = String(roomCode).trim().toLowerCase();
          
          if (currentRoom && rooms.has(currentRoom)) {
            rooms.get(currentRoom)!.clients.delete(ws);
          }

          if (!rooms.has(rCode)) {
            rooms.set(rCode, { clients: new Set(), theme: 'indigo' });
          }
          
          const room = rooms.get(rCode)!;
          room.clients.add(ws);
          currentRoom = rCode;
          currentUsername = username;
          
          const memberCount = room.clients.size;
          console.log(`[${SERVER_ID}] ${username} joined ${rCode} (Total: ${memberCount})`);

          // Confirm to user
          ws.send(JSON.stringify({
            type: "joined",
            roomCode: rCode,
            memberCount: memberCount,
            serverId: SERVER_ID,
            theme: room.theme,
            roomName: room.name || `Room ${rCode}`
          }));

          // Notify others
          broadcast(rCode, {
            type: "system",
            content: `${username || 'Someone'} joined`,
            memberCount: memberCount,
            timestamp: new Date().toISOString(),
            serverId: SERVER_ID
          });
        }

        if (message.type === "chat") {
          if (currentRoom) {
            broadcast(currentRoom, {
              type: "chat",
              id: message.id || Math.random().toString(36).substring(2, 11),
              content: message.content,
              sender: message.sender,
              msgType: message.msgType || 'text',
              fileName: message.fileName,
              fileSize: message.fileSize,
              timestamp: new Date().toISOString(),
              serverId: SERVER_ID
            });
          }
        }

        if (message.type === "typing") {
          if (currentRoom) {
            broadcast(currentRoom, {
              type: "typing",
              sender: message.sender,
              isTyping: message.isTyping
            }, ws);
          }
        }

        if (message.type === "reaction") {
          if (currentRoom) {
            broadcast(currentRoom, {
              type: "reaction",
              messageId: message.messageId,
              reaction: message.reaction,
              sender: message.sender
            });
          }
        }

        if (message.type === "theme") {
          if (currentRoom && rooms.has(currentRoom)) {
            rooms.get(currentRoom)!.theme = message.theme;
            broadcast(currentRoom, {
              type: "theme",
              theme: message.theme
            });
          }
        }

        if (message.type === "rename-room") {
          if (currentRoom && rooms.has(currentRoom)) {
            rooms.get(currentRoom)!.name = message.newName;
            broadcast(currentRoom, {
              type: "rename-room",
              newName: message.newName
            });
          }
        }

        if (message.type === "stream" || 
            message.type === "video-offer" || 
            message.type === "video-answer" || 
            message.type === "new-ice-candidate" || 
            message.type === "end-video-call" ||
            message.type === "whiteboard" ||
            message.type === "poll-vote") {
          if (currentRoom) {
            broadcast(currentRoom, {
              ...message,
              serverId: SERVER_ID
            }, ws);
          }
        }
      } catch (err) {
        console.error(`[${SERVER_ID}] Error:`, err);
      }
    });

    ws.on("close", () => {
      if (currentRoom && rooms.has(currentRoom)) {
        const room = rooms.get(currentRoom)!;
        room.clients.delete(ws);
        const memberCount = room.clients.size;
        
        if (memberCount === 0) {
          rooms.delete(currentRoom);
        } else {
          broadcast(currentRoom, {
            type: "system",
            content: `${currentUsername || 'Someone'} left`,
            memberCount: memberCount,
            timestamp: new Date().toISOString()
          });
        }
      }
    });

    // Keep alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
  });

  function broadcast(roomCode: string, message: any, excludeWs?: WebSocket) {
    const room = rooms.get(roomCode);
    if (room) {
      const payload = JSON.stringify(message);
      let count = 0;
      room.clients.forEach((client) => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
          client.send(payload);
          count++;
        }
      });
      console.log(`Broadcasted ${message.type} to ${count} clients in room ${roomCode}`);
    }
  }

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

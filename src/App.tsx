import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, Users, Send, Copy, ArrowLeft, LogOut, ShieldCheck, Image as ImageIcon, Mic, Smile, Palette, Check, CheckCheck, Monitor, X, Paperclip, FileText, Download, Plus, Video, VideoOff, Pin, PinOff, BarChart2, PenTool, Moon, Sun, Bot, User, Trash2, MoreVertical, History, ChevronRight } from 'lucide-react';
import { Stage, Layer, Line } from 'react-konva';
import confetti from 'canvas-confetti';
import { askAI } from './services/geminiService';

type Message = {
  type: 'chat' | 'system' | 'poll' | 'whiteboard';
  id?: string;
  content: string;
  sender?: string;
  timestamp: string;
  msgType?: 'text' | 'image' | 'audio' | 'file' | 'poll' | 'ai';
  fileName?: string;
  fileSize?: number;
  reactions?: Record<string, string[]>; // emoji -> list of usernames
  readBy?: string[];
  isPinned?: boolean;
  pollData?: {
    question: string;
    options: { text: string, votes: string[] }[];
  };
  avatar?: string;
};

type UserProfile = {
  username: string;
  avatar: string;
};

type Theme = 'indigo' | 'emerald' | 'rose' | 'amber' | 'violet' | 'slate';

const THEMES: Record<Theme, { primary: string, bg: string, text: string }> = {
  indigo: { primary: 'bg-indigo-600', bg: 'bg-indigo-50', text: 'text-indigo-600' },
  emerald: { primary: 'bg-emerald-600', bg: 'bg-emerald-50', text: 'text-emerald-600' },
  rose: { primary: 'bg-rose-600', bg: 'bg-rose-50', text: 'text-rose-600' },
  amber: { primary: 'bg-amber-600', bg: 'bg-amber-50', text: 'text-amber-600' },
  violet: { primary: 'bg-violet-600', bg: 'bg-violet-50', text: 'text-violet-600' },
  slate: { primary: 'bg-slate-800', bg: 'bg-slate-100', text: 'text-slate-800' },
};

export default function App() {
  const [view, setView] = useState<'home' | 'setup' | 'chat'>('home');
  const [mode, setMode] = useState<'create' | 'join' | null>(null);
  const [roomCode, setRoomCode] = useState('');
  const [username, setUsername] = useState(() => localStorage.getItem('sync_username') || '');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [showHistoryView, setShowHistoryView] = useState(false);
  const [joinedRooms, setJoinedRooms] = useState<{code: string, name: string, joinedAt: string}[]>(() => {
    const saved = localStorage.getItem('sync_joined_rooms');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [memberCount, setMemberCount] = useState(1);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [theme, setTheme] = useState<Theme>('indigo');
  const [remoteTyping, setRemoteTyping] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState<string | null>(null); // messageId
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [remoteStream, setRemoteStream] = useState<{ frame: string, sender: string } | null>(null);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  const [remoteVideoStream, setRemoteVideoStream] = useState<MediaStream | null>(null);
  const [isVideoCalling, setIsVideoCalling] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [userAvatar, setUserAvatar] = useState(`https://api.dicebear.com/7.x/avataaars/svg?seed=${username || 'default'}`);
  const [showWhiteboard, setShowWhiteboard] = useState(false);
  const [whiteboardLines, setWhiteboardLines] = useState<any[]>([]);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  
  const socketRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const streamIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, remoteTyping]);

  useEffect(() => {
    if (roomCode && !roomName) {
      setRoomName(`Room ${roomCode}`);
    }
  }, [roomCode]);

  const generateRoomCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
  };

  const handleCreateRoom = () => {
    const code = generateRoomCode();
    setRoomCode(code);
    setMode('create');
    setView('setup');
  };

  const handleJoinRoom = () => {
    setMode('join');
    setView('setup');
  };

  useEffect(() => {
    const interval = setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // Typing indicator logic
  useEffect(() => {
    if (view !== 'chat' || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;

    if (inputMessage.length > 0) {
      socketRef.current.send(JSON.stringify({ type: 'typing', sender: username, isTyping: true }));
      
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socketRef.current?.send(JSON.stringify({ type: 'typing', sender: username, isTyping: false }));
      }, 3000);
    } else {
      socketRef.current.send(JSON.stringify({ type: 'typing', sender: username, isTyping: false }));
    }
  }, [inputMessage]);

  useEffect(() => {
    if (username) {
      localStorage.setItem('sync_username', username);
    }
  }, [username]);

  useEffect(() => {
    localStorage.setItem('sync_joined_rooms', JSON.stringify(joinedRooms));
  }, [joinedRooms]);

  const addToHistory = (code: string, name: string) => {
    setJoinedRooms(prev => {
      const filtered = prev.filter(r => r.code !== code);
      return [{ code, name, joinedAt: new Date().toISOString() }, ...filtered].slice(0, 10);
    });
  };

  const removeFromHistory = (code: string) => {
    setJoinedRooms(prev => prev.filter(r => r.code !== code));
  };

  const connectToRoom = () => {
    if (!username.trim() || !roomCode.trim()) return;

    setConnectionStatus('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${window.location.host}`);

    socket.onopen = () => {
      setConnectionStatus('connected');
      setIsConnected(true);
      socket.send(JSON.stringify({
        type: 'join',
        roomCode: String(roomCode).trim(),
        username
      }));
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'joined') {
        setMemberCount(data.memberCount);
        if (data.theme) setTheme(data.theme as Theme);
        if (data.roomName) {
          setRoomName(data.roomName);
          addToHistory(data.roomCode, data.roomName);
        } else {
          addToHistory(data.roomCode, `Room ${data.roomCode}`);
        }
        setMessages([{
          type: 'system',
          content: `Joined room ${data.roomCode}`,
          timestamp: new Date().toISOString()
        }]);
        setView('chat');
        return;
      }

      if (data.type === 'typing') {
        setRemoteTyping(data.isTyping ? data.sender : null);
        return;
      }

      if (data.type === 'theme') {
        setTheme(data.theme as Theme);
        return;
      }

      if (data.type === 'reaction') {
        setMessages(prev => prev.map(m => {
          if (m.id === data.messageId) {
            const reactions = { ...(m.reactions || {}) };
            if (!reactions[data.reaction]) reactions[data.reaction] = [];
            
            if (reactions[data.reaction].includes(data.sender)) {
              reactions[data.reaction] = reactions[data.reaction].filter(u => u !== data.sender);
            } else {
              reactions[data.reaction].push(data.sender);
            }
            
            if (reactions[data.reaction].length === 0) delete reactions[data.reaction];
            return { ...m, reactions };
          }
          return m;
        }));
        return;
      }

      if (data.type === 'read') {
        setMessages(prev => prev.map(m => {
          if (m.id === data.messageId) {
            const readBy = [...(m.readBy || [])];
            if (!readBy.includes(data.reader)) readBy.push(data.reader);
            return { ...m, readBy };
          }
          return m;
        }));
        return;
      }

      if (data.type === 'stream') {
        if (data.isStopping) {
          setRemoteStream(null);
        } else {
          setRemoteStream({ frame: data.frame, sender: data.sender });
        }
        return;
      }

      if (data.type === 'video-offer') {
        handleVideoOffer(data);
        return;
      }
      if (data.type === 'video-answer') {
        handleVideoAnswer(data);
        return;
      }
      if (data.type === 'new-ice-candidate') {
        handleIceCandidate(data);
        return;
      }
      if (data.type === 'end-video-call') {
        cleanupVideoCall();
        return;
      }

      if (data.type === 'whiteboard') {
        setWhiteboardLines(data.lines);
        return;
      }

      if (data.type === 'poll-vote') {
        setMessages(prev => prev.map(m => {
          if (m.id === data.pollId) {
            const newOptions = m.pollData!.options.map((opt, idx) => {
              if (idx === data.optionIndex) {
                const votes = [...opt.votes];
                if (!votes.includes(data.voter)) votes.push(data.voter);
                return { ...opt, votes };
              }
              // Remove vote from other options
              return { ...opt, votes: opt.votes.filter(v => v !== data.voter) };
            });
            return { ...m, pollData: { ...m.pollData!, options: newOptions } };
          }
          return m;
        }));
        return;
      }

      if (data.type === 'pin') {
        setMessages(prev => prev.map(m => {
          if (m.id === data.messageId) return { ...m, isPinned: data.isPinned };
          return m;
        }));
        return;
      }

      if (data.type === 'rename-room') {
        setRoomName(data.newName);
        return;
      }

      if (data.memberCount !== undefined) setMemberCount(data.memberCount);

      setMessages((prev) => {
        if (data.id && prev.some(m => (m as any).id === data.id)) return prev;
        return [...prev, data];
      });

      // Send read receipt if it's a chat message from someone else
      if (data.type === 'chat' && data.sender !== username) {
        socket.send(JSON.stringify({ type: 'read', messageId: data.id, reader: username }));
      }
    };

    socket.onclose = () => {
      setConnectionStatus('disconnected');
      setIsConnected(false);
      cleanupVideoCall();
      // Attempt to reconnect if we were in a room
      if (view === 'chat') {
        setTimeout(connectToRoom, 2000);
      }
    };

    socketRef.current = socket;
  };

  const sendMessage = (
    content: string, 
    msgType: 'text' | 'image' | 'audio' | 'file' = 'text',
    fileName?: string,
    fileSize?: number
  ) => {
    if (!content.trim() || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;

    const messageData = {
      type: 'chat',
      id: Math.random().toString(36).substring(2, 11),
      content,
      sender: username,
      avatar: userAvatar,
      msgType,
      fileName,
      fileSize
    };

    socketRef.current.send(JSON.stringify(messageData));
    if (msgType === 'text') setInputMessage('');
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      sendMessage(base64, 'image');
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      sendMessage(base64, 'file', file.name, file.size);
    };
    reader.readAsDataURL(file);
  };

  // Video Call Logic
  const createPeerConnection = (stream: MediaStream) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    
    pc.ontrack = (event) => {
      setRemoteVideoStream(event.streams[0]);
    };
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.send(JSON.stringify({
          type: 'new-ice-candidate',
          sender: username,
          candidate: event.candidate
        }));
      }
    };
    
    peerConnectionRef.current = pc;
    return pc;
  };

  const startVideoCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalVideoStream(stream);
      setIsVideoCalling(true);
      
      const pc = createPeerConnection(stream);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      socketRef.current?.send(JSON.stringify({
        type: 'video-offer',
        sender: username,
        offer
      }));
    } catch (err) {
      console.error('Error starting video call:', err);
      alert('Could not access camera/microphone. Please check permissions.');
    }
  };

  const handleVideoOffer = async (data: any) => {
    if (data.sender === username) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalVideoStream(stream);
      setIsVideoCalling(true);
      
      const pc = createPeerConnection(stream);
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      socketRef.current?.send(JSON.stringify({
        type: 'video-answer',
        sender: username,
        answer
      }));
    } catch (err) {
      console.error('Error handling video offer:', err);
    }
  };

  const handleVideoAnswer = async (data: any) => {
    if (data.sender === username) return;
    try {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    } catch (err) {
      console.error('Error handling video answer:', err);
    }
  };

  const handleIceCandidate = async (data: any) => {
    if (data.sender === username) return;
    try {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    } catch (err) {
      console.error('Error handling ice candidate:', err);
    }
  };

  const stopVideoCall = () => {
    socketRef.current?.send(JSON.stringify({
      type: 'end-video-call',
      sender: username
    }));
    cleanupVideoCall();
  };

  const cleanupVideoCall = () => {
    if (localVideoStream) {
      localVideoStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    setLocalVideoStream(null);
    setRemoteVideoStream(null);
    setIsVideoCalling(false);
  };

  const togglePin = (messageId: string, currentStatus: boolean) => {
    socketRef.current?.send(JSON.stringify({
      type: 'pin',
      messageId,
      isPinned: !currentStatus
    }));
  };

  const createPoll = (question: string, options: string[]) => {
    const pollData = {
      question,
      options: options.map(opt => ({ text: opt, votes: [] }))
    };
    
    const messageData = {
      type: 'poll',
      id: Math.random().toString(36).substring(2, 11),
      content: question,
      sender: username,
      avatar: userAvatar,
      msgType: 'poll',
      pollData,
      timestamp: new Date().toISOString()
    };
    
    socketRef.current?.send(JSON.stringify(messageData));
    setShowPollCreator(false);
  };

  const castVote = (pollId: string, optionIndex: number) => {
    socketRef.current?.send(JSON.stringify({
      type: 'poll-vote',
      pollId,
      optionIndex,
      voter: username
    }));
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });
  };

  const handleRenameRoom = () => {
    if (!newRoomName.trim()) return;
    socketRef.current?.send(JSON.stringify({
      type: 'rename-room',
      newName: newRoomName
    }));
    setRoomName(newRoomName);
    addToHistory(roomCode, newRoomName);
    setShowRenameModal(false);
  };

  const handleWhiteboardChange = (newLines: any[]) => {
    setWhiteboardLines(newLines);
    socketRef.current?.send(JSON.stringify({
      type: 'whiteboard',
      lines: newLines
    }));
  };

  const handleAiAssistant = async () => {
    if (!inputMessage.trim()) return;
    
    const userPrompt = inputMessage;
    setInputMessage('');
    setIsAiThinking(true);
    
    // Add user message locally first
    const userMsg: Message = {
      type: 'chat',
      id: Date.now().toString(),
      content: userPrompt,
      sender: username,
      avatar: userAvatar,
      timestamp: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMsg]);

    const history = messages
      .filter(m => m.type === 'chat')
      .slice(-10)
      .map(m => ({
        role: m.sender === username ? "user" : "model",
        parts: [{ text: m.content }]
      }));

    const aiResponse = await askAI(userPrompt, history);
    
    const aiMsg: Message = {
      type: 'chat',
      id: (Date.now() + 1).toString(),
      content: aiResponse,
      sender: 'SyncBot',
      avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=SyncBot',
      msgType: 'ai',
      timestamp: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, aiMsg]);
    setIsAiThinking(false);
  };

  const exportChatHistory = () => {
    const text = messages.map(m => {
      const time = new Date(m.timestamp).toLocaleTimeString();
      if (m.type === 'system') return `[${time}] SYSTEM: ${m.content}`;
      return `[${time}] ${m.sender}: ${m.content}`;
    }).join('\n');
    
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SyncChat_${roomCode}_History.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64 = event.target?.result as string;
          sendMessage(base64, 'audio');
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Error recording audio:', err);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const addReaction = (messageId: string, reaction: string) => {
    socketRef.current?.send(JSON.stringify({ type: 'reaction', messageId, reaction, sender: username }));
    setShowEmojiPicker(null);
  };

  const changeTheme = (newTheme: Theme) => {
    socketRef.current?.send(JSON.stringify({ type: 'theme', theme: newTheme }));
    setShowThemePicker(false);
  };

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 } });
      screenStreamRef.current = stream;
      setIsStreaming(true);

      const video = document.createElement('video');
      video.srcObject = stream;
      video.play();

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      streamIntervalRef.current = setInterval(() => {
        if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth / 2; // Downscale for performance
          canvas.height = video.videoHeight / 2;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = canvas.toDataURL('image/jpeg', 0.5);
          socketRef.current?.send(JSON.stringify({
            type: 'stream',
            sender: username,
            frame
          }));
        }
      }, 200); // 5 FPS

      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };

    } catch (err: any) {
      console.error('Error sharing screen:', err);
      if (err.name === 'NotAllowedError' || err.message.includes('permissions policy')) {
        alert("Screen sharing permission was denied. Please make sure you've allowed 'Display Capture' in your browser settings and try refreshing the page.");
      } else {
        alert("Could not start screen share. Please try again.");
      }
      setIsStreaming(false);
    }
  };

  const stopScreenShare = () => {
    if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
    }
    socketRef.current?.send(JSON.stringify({
      type: 'stream',
      sender: username,
      isStopping: true
    }));
    setIsStreaming(false);
    screenStreamRef.current = null;
  };

  const leaveRoom = () => {
    cleanupVideoCall();
    socketRef.current?.close();
    setView('home');
    setMessages([]);
    setRoomCode('');
    setUsername('');
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(roomCode);
  };

  const copyShareLink = () => {
    navigator.clipboard.writeText(window.location.href);
    alert('Link copied! Send this EXACT link to your friend.');
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${isDarkMode ? 'bg-[#0F172A] text-slate-200' : 'bg-[#F5F5F5] text-[#1A1A1A]'} font-sans selection:bg-indigo-100`}>
      <div className="max-w-md mx-auto min-h-screen flex flex-col p-4 md:p-6">
        
        <AnimatePresence mode="wait">
          {view === 'home' && !showHistoryView && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex flex-col justify-center space-y-8"
            >
              <div className="text-center space-y-2">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-sm border border-black/5 mb-4">
                  <MessageSquare className="w-8 h-8 text-indigo-600" />
                </div>
                <h1 className="text-4xl font-bold tracking-tight">SyncChat</h1>
                <p className="text-neutral-500">Secure, real-time room-based chat.</p>
              </div>

              <div className="grid gap-4">
                <button
                  onClick={handleCreateRoom}
                  className="group relative flex items-center justify-between p-6 bg-white rounded-2xl border border-black/5 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all text-left"
                >
                  <div>
                    <h3 className="font-semibold text-lg">Create a Room</h3>
                    <p className="text-sm text-neutral-500">Start a new private session</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                    <Users className="w-5 h-5" />
                  </div>
                </button>

                <button
                  onClick={handleJoinRoom}
                  className="group relative flex items-center justify-between p-6 bg-white rounded-2xl border border-black/5 shadow-sm hover:shadow-md hover:border-emerald-200 transition-all text-left"
                >
                  <div>
                    <h3 className="font-semibold text-lg">Join a Room</h3>
                    <p className="text-sm text-neutral-500">Connect with an existing code</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                </button>

                <button
                  onClick={() => setShowHistoryView(true)}
                  className="group relative flex items-center justify-between p-6 bg-white rounded-2xl border border-black/5 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all text-left"
                >
                  <div>
                    <h3 className="font-semibold text-lg">Room History</h3>
                    <p className="text-sm text-neutral-500">{joinedRooms.length} past rooms saved</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                    <History className="w-5 h-5" />
                  </div>
                </button>
              </div>
            </motion.div>
          )}

          {view === 'home' && showHistoryView && (
            <motion.div
              key="history"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 flex flex-col justify-center space-y-6"
            >
              <button 
                onClick={() => setShowHistoryView(false)}
                className="inline-flex items-center text-sm text-neutral-500 hover:text-black transition-colors"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to home
              </button>

              <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                      <History className="w-5 h-5" />
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight">Room History</h2>
                  </div>
                  {joinedRooms.length > 0 && (
                    <button 
                      onClick={() => {
                        if (confirm('Are you sure you want to clear your room history?')) {
                          setJoinedRooms([]);
                          localStorage.removeItem('sync_joined_rooms');
                        }
                      }}
                      className="text-[10px] font-bold text-red-500 hover:text-red-600 uppercase tracking-widest transition-colors"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                {joinedRooms.length > 0 ? (
                  <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 scrollbar-hide">
                    {joinedRooms.map((room) => (
                      <motion.div 
                        key={room.code}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="group flex items-center space-x-4 p-4 bg-neutral-50 hover:bg-white border border-black/5 hover:border-indigo-500/30 rounded-2xl transition-all cursor-pointer shadow-sm hover:shadow-md"
                        onClick={() => {
                          setRoomCode(room.code);
                          setRoomName(room.name);
                          if (username) {
                            setTimeout(connectToRoom, 10);
                          } else {
                            setMode('join');
                            setView('setup');
                          }
                        }}
                      >
                        <div className="w-12 h-12 bg-white text-indigo-600 rounded-xl flex items-center justify-center font-bold text-lg border border-black/5 shrink-0">
                          {room.code.slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-base font-bold text-neutral-800 truncate">{room.name}</p>
                          <p className="text-xs text-neutral-400 font-mono tracking-wider">{room.code}</p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <div className="w-10 h-10 rounded-full bg-white border border-black/5 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                            <Send className="w-5 h-5" />
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm('Remove this room from history?')) {
                                const newHistory = joinedRooms.filter(r => r.code !== room.code);
                                setJoinedRooms(newHistory);
                                localStorage.setItem('sync_joined_rooms', JSON.stringify(newHistory));
                              }
                            }}
                            className="w-10 h-10 rounded-full bg-white border border-black/5 flex items-center justify-center text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <div className="p-12 border-2 border-dashed border-black/5 rounded-3xl text-center space-y-4 bg-neutral-50/50">
                    <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-black/5 flex items-center justify-center mx-auto">
                      <Bot className="w-8 h-8 text-neutral-300" />
                    </div>
                    <div className="space-y-2">
                      <p className="text-lg font-bold text-neutral-400">No History Yet</p>
                      <p className="text-sm text-neutral-400 font-medium italic px-6 leading-relaxed">
                        Your joined rooms will appear here automatically for quick access.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {view === 'setup' && (
            <motion.div
              key="setup"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 flex flex-col justify-center space-y-6"
            >
              <button 
                onClick={() => setView('home')}
                className="inline-flex items-center text-sm text-neutral-500 hover:text-black transition-colors"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to home
              </button>

              <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5 space-y-6">
                <h2 className="text-2xl font-bold">
                  {mode === 'create' ? 'Room Created' : 'Join Room'}
                </h2>

                {mode === 'create' ? (
                  <div className="space-y-4">
                    <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Your Room Code</label>
                    <div className="flex items-center justify-between p-4 bg-neutral-50 rounded-xl border border-black/5">
                      <span className="text-3xl font-mono font-bold tracking-widest text-indigo-600">{roomCode}</span>
                      <button 
                        onClick={copyToClipboard}
                        className="p-2 hover:bg-white rounded-lg transition-colors"
                      >
                        <Copy className="w-5 h-5 text-neutral-400" />
                      </button>
                    </div>
                    <p className="text-sm text-neutral-500 italic">Share this 6-digit code with your friend.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Enter Room Code</label>
                    <input
                      type="text"
                      maxLength={6}
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="000000"
                      className="w-full p-4 text-3xl font-mono font-bold tracking-widest text-center bg-neutral-50 rounded-xl border border-black/5 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Your Name</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your name"
                    className="w-full p-4 bg-neutral-50 rounded-xl border border-black/5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                </div>

                <button
                  onClick={connectToRoom}
                  disabled={!username.trim() || roomCode.length !== 6}
                  className="w-full py-4 bg-black text-white rounded-xl font-semibold shadow-lg hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  Start Chatting
                </button>

                {joinedRooms.length > 0 && (
                  <div className="pt-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-widest text-neutral-400">Recent Rooms</label>
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                        {joinedRooms.length} Saved
                      </span>
                    </div>
                    <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1 scrollbar-hide">
                      {joinedRooms.map((room) => (
                        <div 
                          key={room.code}
                          className="group flex items-center space-x-3 p-3 bg-neutral-50 hover:bg-white border border-black/5 hover:border-indigo-500/30 rounded-xl transition-all cursor-pointer shadow-sm hover:shadow-md"
                          onClick={() => {
                            setRoomCode(room.code);
                            setRoomName(room.name);
                            // We need a small delay to ensure state updates before connecting
                            setTimeout(connectToRoom, 50);
                          }}
                        >
                          <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center font-bold text-sm shrink-0">
                            {room.code.slice(0, 2)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-neutral-800 truncate">{room.name}</p>
                            <p className="text-[10px] text-neutral-400 font-mono">{room.code}</p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFromHistory(room.code);
                            }}
                            className="p-2 text-neutral-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {view === 'chat' && (
            <motion.div
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col h-full max-h-screen"
            >
              {/* Chat Header */}
              <div className="flex items-center justify-between py-4 border-b border-black/5 relative">
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 rounded-full ${THEMES[theme].primary} flex items-center justify-center text-white font-bold shadow-sm`}>
                    {roomCode.slice(0, 2)}
                  </div>
                  <div>
                    <h3 
                      className="font-bold leading-tight cursor-pointer hover:text-indigo-600 transition-colors"
                      onDoubleClick={() => {
                        setNewRoomName(roomName);
                        setShowRenameModal(true);
                      }}
                      title="Double click to rename"
                    >
                      {roomName}
                    </h3>
                    <div className="flex items-center text-xs text-emerald-600 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>
                      {memberCount} {memberCount === 1 ? 'User' : 'Users'} Online
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-1 relative">
                  <button 
                    onClick={() => setShowMoreMenu(!showMoreMenu)}
                    className={`p-2 rounded-full transition-all ${showMoreMenu ? 'bg-neutral-100 text-black' : 'text-neutral-400 hover:text-black hover:bg-neutral-50'}`}
                    title="Menu"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </button>

                  <AnimatePresence>
                    {showMoreMenu && (
                      <>
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="fixed inset-0 z-40"
                          onClick={() => setShowMoreMenu(false)}
                        />
                        <motion.div
                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.95 }}
                          className={`absolute top-full right-0 mt-2 w-56 rounded-2xl shadow-xl border border-black/5 z-50 overflow-hidden ${isDarkMode ? 'bg-slate-800' : 'bg-white'}`}
                        >
                          <div className="p-2 space-y-1">
                            <button 
                              onClick={() => { setIsDarkMode(!isDarkMode); setShowMoreMenu(false); }}
                              className={`w-full flex items-center space-x-3 p-3 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-slate-700 text-white' : 'hover:bg-neutral-50 text-black'}`}
                            >
                              <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-slate-700 text-amber-400' : 'bg-amber-50 text-amber-600'}`}>
                                {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                              </div>
                              <span className="text-sm font-medium">{isDarkMode ? 'Light Mode' : 'Dark Mode'}</span>
                            </button>

                            <button 
                              onClick={() => { exportChatHistory(); setShowMoreMenu(false); }}
                              className={`w-full flex items-center space-x-3 p-3 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-slate-700 text-white' : 'hover:bg-neutral-50 text-black'}`}
                            >
                              <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-slate-700 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>
                                <Download className="w-4 h-4" />
                              </div>
                              <span className="text-sm font-medium">Export History</span>
                            </button>

                            <button 
                              onClick={() => { setShowPinnedOnly(!showPinnedOnly); setShowMoreMenu(false); }}
                              className={`w-full flex items-center space-x-3 p-3 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-slate-700 text-white' : 'hover:bg-neutral-50 text-black'}`}
                            >
                              <div className={`p-2 rounded-lg ${showPinnedOnly ? 'bg-amber-500 text-white' : isDarkMode ? 'bg-slate-700 text-amber-400' : 'bg-amber-50 text-amber-600'}`}>
                                <Pin className="w-4 h-4" />
                              </div>
                              <span className="text-sm font-medium">{showPinnedOnly ? 'Show All Messages' : 'Show Pinned Only'}</span>
                            </button>

                            <button 
                              onClick={() => { setShowThemePicker(!showThemePicker); setShowMoreMenu(false); }}
                              className={`w-full flex items-center space-x-3 p-3 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-slate-700 text-white' : 'hover:bg-neutral-50 text-black'}`}
                            >
                              <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-slate-700 text-indigo-400' : 'bg-indigo-50 text-indigo-600'}`}>
                                <Palette className="w-4 h-4" />
                              </div>
                              <span className="text-sm font-medium">Change Theme</span>
                            </button>

                            <div className={`h-px my-1 ${isDarkMode ? 'bg-slate-700' : 'bg-neutral-100'}`} />

                            <button 
                              onClick={() => { isVideoCalling ? stopVideoCall() : startVideoCall(); setShowMoreMenu(false); }}
                              className={`w-full flex items-center space-x-3 p-3 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-slate-700 text-white' : 'hover:bg-neutral-50 text-black'}`}
                            >
                              <div className={`p-2 rounded-lg ${isVideoCalling ? 'bg-red-500 text-white' : isDarkMode ? 'bg-slate-700 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
                                {isVideoCalling ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                              </div>
                              <span className="text-sm font-medium">{isVideoCalling ? 'End Video Call' : 'Start Video Call'}</span>
                            </button>

                            <button 
                              onClick={() => { isStreaming ? stopScreenShare() : startScreenShare(); setShowMoreMenu(false); }}
                              className={`w-full flex items-center space-x-3 p-3 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-slate-700 text-white' : 'hover:bg-neutral-50 text-black'}`}
                            >
                              <div className={`p-2 rounded-lg ${isStreaming ? 'bg-red-500 text-white' : isDarkMode ? 'bg-slate-700 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>
                                <Monitor className="w-4 h-4" />
                              </div>
                              <span className="text-sm font-medium">{isStreaming ? 'Stop Sharing' : 'Screen Sharing'}</span>
                            </button>

                            <button 
                              onClick={() => {
                                localStorage.removeItem('sync_username');
                                localStorage.removeItem('sync_joined_rooms');
                                window.location.reload();
                              }}
                              className={`w-full flex items-center space-x-3 p-3 rounded-xl transition-colors text-red-500 ${isDarkMode ? 'hover:bg-red-500/10' : 'hover:bg-red-50'}`}
                            >
                              <div className="p-2 bg-red-50 text-red-600 rounded-lg">
                                <Trash2 className="w-4 h-4" />
                              </div>
                              <span className="text-sm font-medium">Logout & Clear Data</span>
                            </button>

                            <div className={`h-px my-1 ${isDarkMode ? 'bg-slate-700' : 'bg-neutral-100'}`} />

                            <button 
                              onClick={() => { leaveRoom(); setShowMoreMenu(false); }}
                              className={`w-full flex items-center space-x-3 p-3 rounded-xl transition-colors text-neutral-500 ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-neutral-50'}`}
                            >
                              <div className="p-2 bg-neutral-100 text-neutral-600 rounded-lg">
                                <LogOut className="w-4 h-4" />
                              </div>
                              <span className="text-sm font-medium">Leave Room</span>
                            </button>
                          </div>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>

                <AnimatePresence>
                  {showThemePicker && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute top-full right-0 mt-2 p-3 bg-white rounded-2xl shadow-xl border border-black/5 z-50 grid grid-cols-3 gap-2"
                    >
                      {(Object.keys(THEMES) as Theme[]).map((t) => (
                        <button
                          key={t}
                          onClick={() => changeTheme(t)}
                          className={`w-8 h-8 rounded-full ${THEMES[t].primary} ${theme === t ? 'ring-2 ring-offset-2 ring-black' : ''}`}
                        />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto py-6 space-y-6 scrollbar-hide px-2">
                {/* Video Call Display */}
                <AnimatePresence>
                  {isVideoCalling && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-6 overflow-hidden rounded-2xl border border-black/5 shadow-lg bg-black relative aspect-video"
                    >
                      {/* Remote Video */}
                      {remoteVideoStream ? (
                        <video
                          autoPlay
                          playsInline
                          ref={(el) => { if (el) el.srcObject = remoteVideoStream; }}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/50 text-xs font-bold uppercase tracking-widest">
                          Connecting...
                        </div>
                      )}

                      {/* Local Video (Picture-in-Picture) */}
                      <div className="absolute bottom-4 right-4 w-32 aspect-video bg-neutral-800 rounded-lg overflow-hidden border border-white/20 shadow-xl">
                        {localVideoStream && (
                          <video
                            autoPlay
                            playsInline
                            muted
                            ref={(el) => { if (el) el.srcObject = localVideoStream; }}
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>

                      <div className="absolute top-4 left-4 flex items-center space-x-2">
                        <div className="bg-black/50 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-bold text-white uppercase tracking-widest flex items-center">
                          <span className="w-2 h-2 bg-red-500 rounded-full mr-2 animate-pulse" />
                          Live Video Call
                        </div>
                      </div>

                      <button
                        onClick={stopVideoCall}
                        className="absolute bottom-4 left-4 p-2 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 transition-colors"
                        title="End Call"
                      >
                        <VideoOff className="w-5 h-5" />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Remote Screen Share Display */}
                <AnimatePresence>
                  {remoteStream && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-6 overflow-hidden rounded-2xl border border-black/5 shadow-lg bg-black relative group"
                    >
                      <img src={remoteStream.frame} className="w-full h-auto" alt="Screen Share" />
                      <div className="absolute top-3 left-3 bg-black/50 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-bold text-white uppercase tracking-widest flex items-center">
                        <span className="w-2 h-2 bg-red-500 rounded-full mr-2 animate-pulse" />
                        {remoteStream.sender}'s Screen
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {messages.length <= 1 && memberCount === 1 && !remoteStream && (
                  <div className="flex flex-col items-center justify-center h-full space-y-4 text-center px-6">
                    <div className={`w-12 h-12 ${THEMES[theme].bg} rounded-full flex items-center justify-center animate-bounce`}>
                      <Users className={`w-6 h-6 ${THEMES[theme].text}`} />
                    </div>
                    <div className="space-y-1">
                      <p className="font-bold text-neutral-800">Waiting for friend...</p>
                      <p className="text-xs text-neutral-500">
                        Give them code <span className={`font-mono font-bold ${THEMES[theme].text}`}>{roomCode}</span>
                      </p>
                    </div>
                  </div>
                )}
                
                {messages.filter(m => !showPinnedOnly || m.isPinned).map((msg, i) => (
                  <div 
                    key={msg.id || i} 
                    className={`flex flex-col ${msg.type === 'system' ? 'items-center' : msg.sender === username ? 'items-end' : 'items-start'}`}
                  >
                    {msg.type === 'system' ? (
                      <span className="text-[10px] uppercase tracking-widest font-bold text-neutral-400 bg-neutral-100 px-3 py-1 rounded-full">
                        {msg.content}
                      </span>
                    ) : (
                      <div className={`max-w-[85%] space-y-1 group relative flex flex-col ${msg.sender === username ? 'items-end' : 'items-start'}`}>
                        <div className={`flex items-center space-x-2 ${msg.sender === username ? 'flex-row-reverse space-x-reverse' : 'flex-row'}`}>
                          <img 
                            src={msg.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${msg.sender}`} 
                            className="w-6 h-6 rounded-full border border-black/5" 
                            alt="avatar" 
                          />
                          <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-tighter">
                            {msg.sender}
                          </span>
                          {msg.isPinned && <Pin className="w-3 h-3 text-amber-500 fill-amber-500" />}
                        </div>
                        
                        <div className="relative flex items-center gap-2">
                          {msg.sender === username && (
                            <div className="flex flex-col space-y-1 opacity-0 group-hover:opacity-100 transition-all">
                              <button 
                                onClick={() => togglePin(msg.id!, !!msg.isPinned)}
                                className={`p-1 rounded-full transition-all ${msg.isPinned ? 'text-amber-500 bg-amber-50' : 'text-neutral-400 hover:bg-neutral-100'}`}
                              >
                                <Pin className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => setShowEmojiPicker(showEmojiPicker === msg.id ? null : msg.id!)}
                                className="p-1 hover:bg-neutral-100 rounded-full transition-all"
                              >
                                <Smile className="w-4 h-4 text-neutral-400" />
                              </button>
                            </div>
                          )}

                          <div className={`p-3 rounded-2xl text-sm shadow-sm relative ${
                            msg.msgType === 'ai'
                              ? 'bg-indigo-600 text-white rounded-tl-none'
                              : msg.sender === username 
                                ? `${THEMES[theme].primary} text-white rounded-tr-none` 
                                : isDarkMode ? 'bg-slate-800 text-white border border-white/5 rounded-tl-none' : 'bg-white text-black border border-black/5 rounded-tl-none'
                          }`}>
                            {msg.msgType === 'image' ? (
                              <img src={msg.content} className="max-w-full rounded-lg" alt="Shared" referrerPolicy="no-referrer" />
                            ) : msg.msgType === 'audio' ? (
                              <audio src={msg.content} controls className="max-w-full h-8" />
                            ) : msg.msgType === 'poll' ? (
                              <div className="space-y-3 min-w-[200px]">
                                <h4 className="font-bold flex items-center">
                                  <BarChart2 className="w-4 h-4 mr-2" />
                                  {msg.pollData?.question}
                                </h4>
                                <div className="space-y-2">
                                  {msg.pollData?.options.map((opt, idx) => {
                                    const totalVotes = msg.pollData!.options.reduce((acc, o) => acc + o.votes.length, 0);
                                    const percentage = totalVotes === 0 ? 0 : (opt.votes.length / totalVotes) * 100;
                                    const hasVoted = opt.votes.includes(username);
                                    
                                    return (
                                      <button
                                        key={idx}
                                        onClick={() => castVote(msg.id!, idx)}
                                        className={`w-full relative p-2 rounded-xl border text-left transition-all overflow-hidden ${
                                          hasVoted ? 'border-indigo-500 bg-indigo-50/10' : 'border-black/5 hover:bg-black/5'
                                        }`}
                                      >
                                        <div 
                                          className="absolute inset-0 bg-indigo-500/10 transition-all duration-500" 
                                          style={{ width: `${percentage}%` }}
                                        />
                                        <div className="relative flex justify-between items-center text-xs">
                                          <span className="font-medium">{opt.text}</span>
                                          <span className="font-bold">{opt.votes.length}</span>
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : msg.msgType === 'file' ? (
                              <div className={`flex items-center space-x-3 p-2 rounded-xl ${msg.sender === username ? 'bg-white/10' : 'bg-black/5'}`}>
                                <div className="p-2 bg-white rounded-lg shadow-sm">
                                  <FileText className="w-5 h-5 text-neutral-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium truncate">{msg.fileName}</p>
                                  <p className="text-[10px] opacity-60">
                                    {msg.fileSize ? (msg.fileSize / 1024).toFixed(1) : '0'} KB
                                  </p>
                                </div>
                                <a 
                                  href={msg.content} 
                                  download={msg.fileName}
                                  className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                                >
                                  <Download className="w-4 h-4" />
                                </a>
                              </div>
                            ) : (
                              msg.content
                            )}

                            {/* Reactions display */}
                            {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                              <div className="absolute -bottom-3 right-0 flex -space-x-1">
                                {Object.entries(msg.reactions as Record<string, string[]>).map(([emoji, users]) => (
                                  <div key={emoji} title={users.join(', ')} className="bg-white border border-black/5 rounded-full px-1.5 py-0.5 text-[10px] shadow-sm cursor-default text-black">
                                    {emoji} {users.length > 1 && users.length}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {msg.sender !== username && (
                            <div className="flex flex-col space-y-1 opacity-0 group-hover:opacity-100 transition-all">
                              <button 
                                onClick={() => togglePin(msg.id!, !!msg.isPinned)}
                                className={`p-1 rounded-full transition-all ${msg.isPinned ? 'text-amber-500 bg-amber-50' : 'text-neutral-400 hover:bg-neutral-100'}`}
                              >
                                <Pin className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => setShowEmojiPicker(showEmojiPicker === msg.id ? null : msg.id!)}
                                className="p-1 hover:bg-neutral-100 rounded-full transition-all"
                              >
                                <Smile className="w-4 h-4 text-neutral-400" />
                              </button>
                            </div>
                          )}

                          {/* Emoji Picker Popover */}
                          <AnimatePresence>
                            {showEmojiPicker === msg.id && (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className={`absolute bottom-full mb-2 p-2 bg-white rounded-xl shadow-xl border border-black/5 z-50 flex gap-2 ${msg.sender === username ? 'right-0' : 'left-0'}`}
                              >
                                {['👍', '❤️', '😂', '😮', '😢', '🔥'].map(emoji => (
                                  <button key={emoji} onClick={() => addReaction(msg.id!, emoji)} className="hover:scale-125 transition-transform">
                                    {emoji}
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        <div className="flex items-center space-x-1 px-1">
                          <span className="text-[9px] text-neutral-400">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {msg.sender === username && (
                            <div className="flex items-center">
                              {msg.readBy && msg.readBy.length > 0 ? (
                                <CheckCheck className="w-3 h-3 text-blue-500" />
                              ) : (
                                <Check className="w-3 h-3 text-neutral-300" />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {remoteTyping && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center space-x-2 text-neutral-400"
                  >
                    <div className="flex space-x-1">
                      <div className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-1 h-1 bg-neutral-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest">{remoteTyping} is typing</span>
                  </motion.div>
                )}
                {isAiThinking && (
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center space-x-3 text-indigo-600"
                  >
                    <div className="w-6 h-6 bg-indigo-100 rounded-full flex items-center justify-center">
                      <Bot className="w-4 h-4 animate-pulse" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest">SyncBot is thinking...</span>
                  </motion.div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Whiteboard Overlay */}
              <AnimatePresence>
                {showWhiteboard && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="fixed inset-4 z-[100] bg-white rounded-3xl shadow-2xl border border-black/10 overflow-hidden flex flex-col"
                  >
                    <div className="p-4 border-b border-black/5 flex items-center justify-between bg-neutral-50">
                      <div className="flex items-center space-x-3">
                        <div className="p-2 bg-purple-100 text-purple-600 rounded-xl">
                          <PenTool className="w-5 h-5" />
                        </div>
                        <h3 className="font-bold">Collaborative Whiteboard</h3>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button 
                          onClick={() => handleWhiteboardChange([])}
                          className="p-2 text-neutral-400 hover:text-red-500 transition-colors"
                          title="Clear Canvas"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => setShowWhiteboard(false)}
                          className="p-2 text-neutral-400 hover:text-black transition-colors"
                        >
                          <X className="w-6 h-6" />
                        </button>
                      </div>
                    </div>
                    <div className="flex-1 bg-white relative cursor-crosshair">
                      <Stage
                        width={window.innerWidth - 32}
                        height={window.innerHeight - 150}
                        onMouseDown={(e) => {
                          const pos = e.target.getStage()?.getPointerPosition();
                          handleWhiteboardChange([...whiteboardLines, { points: [pos?.x, pos?.y] }]);
                        }}
                        onMouseMove={(e) => {
                          if (e.evt.buttons !== 1) return;
                          const stage = e.target.getStage();
                          const point = stage?.getPointerPosition();
                          let lastLine = whiteboardLines[whiteboardLines.length - 1];
                          if (!lastLine) return;
                          lastLine.points = lastLine.points.concat([point?.x, point?.y]);
                          whiteboardLines.splice(whiteboardLines.length - 1, 1, lastLine);
                          handleWhiteboardChange(whiteboardLines.concat());
                        }}
                      >
                        <Layer>
                          {whiteboardLines.map((line, i) => (
                            <Line
                              key={i}
                              points={line.points}
                              stroke="#4F46E5"
                              strokeWidth={3}
                              tension={0.5}
                              lineCap="round"
                              globalCompositeOperation="source-over"
                            />
                          ))}
                        </Layer>
                      </Stage>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Poll Creator Overlay */}
              <AnimatePresence>
                {showPollCreator && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
                  >
                    <motion.div
                      initial={{ scale: 0.9, y: 20 }}
                      animate={{ scale: 1, y: 0 }}
                      className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
                    >
                      <div className="p-6 space-y-6">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xl font-bold">Create a Poll</h3>
                          <button onClick={() => setShowPollCreator(false)} className="text-neutral-400 hover:text-black">
                            <X className="w-6 h-6" />
                          </button>
                        </div>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-neutral-400 uppercase tracking-widest">Question</label>
                            <input 
                              id="poll-q"
                              type="text" 
                              placeholder="What's on your mind?" 
                              className="w-full p-3 bg-neutral-50 rounded-xl border border-black/5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-neutral-400 uppercase tracking-widest">Options (comma separated)</label>
                            <input 
                              id="poll-opts"
                              type="text" 
                              placeholder="Option 1, Option 2, Option 3" 
                              className="w-full p-3 bg-neutral-50 rounded-xl border border-black/5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            />
                          </div>
                        </div>
                        <button 
                          onClick={() => {
                            const q = (document.getElementById('poll-q') as HTMLInputElement).value;
                            const opts = (document.getElementById('poll-opts') as HTMLInputElement).value.split(',').map(s => s.trim()).filter(s => s);
                            if (q && opts.length >= 2) createPoll(q, opts);
                          }}
                          className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg hover:bg-indigo-700 transition-all"
                        >
                          Launch Poll
                        </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input Area */}
              <form 
                onSubmit={(e) => { e.preventDefault(); sendMessage(inputMessage); }}
                className="py-4 flex flex-col space-y-2"
              >
                <div className="flex items-center space-x-2">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
                      className={`p-2 rounded-full transition-all ${showAttachmentMenu ? 'bg-indigo-100 text-indigo-600 rotate-45' : 'text-neutral-400 hover:text-black hover:bg-neutral-100'}`}
                    >
                      <Plus className="w-6 h-6" />
                    </button>

                    <AnimatePresence>
                      {showAttachmentMenu && (
                        <>
                          <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-40"
                            onClick={() => setShowAttachmentMenu(false)}
                          />
                          <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute bottom-full left-0 mb-2 w-48 bg-white rounded-2xl shadow-xl border border-black/5 z-50 overflow-hidden"
                          >
                            <div className="p-2 space-y-1">
                              <label className="flex items-center space-x-3 p-3 hover:bg-neutral-50 rounded-xl cursor-pointer transition-colors group">
                                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg group-hover:bg-blue-100 transition-colors">
                                  <ImageIcon className="w-5 h-5" />
                                </div>
                                <span className="text-sm font-medium">Gallery</span>
                                <input 
                                  type="file" 
                                  accept="image/*" 
                                  className="hidden" 
                                  onChange={(e) => { handleImageUpload(e); setShowAttachmentMenu(false); }} 
                                />
                              </label>

                              <label className="flex items-center space-x-3 p-3 hover:bg-neutral-50 rounded-xl cursor-pointer transition-colors group">
                                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg group-hover:bg-emerald-100 transition-colors">
                                  <Paperclip className="w-5 h-5" />
                                </div>
                                <span className="text-sm font-medium">File Sharing</span>
                                <input 
                                  type="file" 
                                  className="hidden" 
                                  onChange={(e) => { handleFileUpload(e); setShowAttachmentMenu(false); }} 
                                />
                              </label>

                              <button
                                type="button"
                                onMouseDown={startRecording}
                                onMouseUp={() => { stopRecording(); setShowAttachmentMenu(false); }}
                                onTouchStart={startRecording}
                                onTouchEnd={() => { stopRecording(); setShowAttachmentMenu(false); }}
                                className={`w-full flex items-center space-x-3 p-3 hover:bg-neutral-50 rounded-xl transition-colors group ${isRecording ? 'bg-red-50' : ''}`}
                              >
                                <div className={`p-2 rounded-lg transition-colors ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-rose-50 text-rose-600 group-hover:bg-rose-100'}`}>
                                  <Mic className="w-5 h-5" />
                                </div>
                                <span className="text-sm font-medium">{isRecording ? 'Recording...' : 'Voice Note'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => { setShowWhiteboard(true); setShowAttachmentMenu(false); }}
                                className="w-full flex items-center space-x-3 p-3 hover:bg-neutral-50 rounded-xl transition-colors group"
                              >
                                <div className="p-2 bg-purple-50 text-purple-600 rounded-lg group-hover:bg-purple-100 transition-colors">
                                  <PenTool className="w-5 h-5" />
                                </div>
                                <span className="text-sm font-medium">Whiteboard</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => { setShowPollCreator(true); setShowAttachmentMenu(false); }}
                                className="w-full flex items-center space-x-3 p-3 hover:bg-neutral-50 rounded-xl transition-colors group"
                              >
                                <div className="p-2 bg-amber-50 text-amber-600 rounded-lg group-hover:bg-amber-100 transition-colors">
                                  <BarChart2 className="w-5 h-5" />
                                </div>
                                <span className="text-sm font-medium">Create Poll</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => { handleAiAssistant(); setShowAttachmentMenu(false); }}
                                className="w-full flex items-center space-x-3 p-3 hover:bg-neutral-50 rounded-xl transition-colors group"
                              >
                                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg group-hover:bg-indigo-100 transition-colors">
                                  <Bot className="w-5 h-5" />
                                </div>
                                <span className="text-sm font-medium">Ask SyncBot</span>
                              </button>
                            </div>
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>

                  <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder={isRecording ? "Recording..." : "Type a message..."}
                    className="flex-1 p-3 bg-white rounded-2xl border border-black/5 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                  />
                  <button
                    type="submit"
                    disabled={!inputMessage.trim() || connectionStatus !== 'connected'}
                    className={`w-11 h-11 ${THEMES[theme].primary} text-white rounded-2xl flex items-center justify-center shadow-lg hover:opacity-90 disabled:opacity-50 transition-all`}
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center space-x-2">
                    <span className={`w-2 h-2 rounded-full ${
                      connectionStatus === 'connected' ? 'bg-emerald-500' : 
                      connectionStatus === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
                    }`} />
                    <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">
                      {connectionStatus}
                    </span>
                  </div>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Rename Room Modal */}
        <AnimatePresence>
          {showRenameModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className={`w-full max-w-md p-6 rounded-3xl shadow-2xl border border-black/5 ${isDarkMode ? 'bg-slate-800 text-white' : 'bg-white text-black'}`}
              >
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold">Rename Room</h2>
                  <button onClick={() => setShowRenameModal(false)} className={`p-2 rounded-full transition-colors ${isDarkMode ? 'hover:bg-slate-700' : 'hover:bg-neutral-100'}`}>
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase tracking-widest mb-2">New Room Name</label>
                    <input
                      type="text"
                      value={newRoomName}
                      onChange={(e) => setNewRoomName(e.target.value)}
                      placeholder="Enter new room name"
                      className={`w-full p-4 rounded-xl border border-black/5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all ${isDarkMode ? 'bg-slate-700 text-white' : 'bg-neutral-50 text-black'}`}
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && handleRenameRoom()}
                    />
                  </div>
                  
                  <div className="flex space-x-3 pt-2">
                    <button
                      onClick={() => setShowRenameModal(false)}
                      className={`flex-1 py-3 rounded-xl font-semibold transition-all ${isDarkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-neutral-100 hover:bg-neutral-200'}`}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleRenameRoom}
                      disabled={!newRoomName.trim()}
                      className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-semibold shadow-lg shadow-indigo-500/20 hover:bg-indigo-700 disabled:opacity-50 transition-all"
                    >
                      Save Name
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

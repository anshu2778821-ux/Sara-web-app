import React, { useState, useEffect, useRef } from 'react';
import { Mic, Send, Camera, Settings, X, Trash2, Volume2, VolumeX, ImagePlus, RefreshCw, Phone, Video, PhoneOff, SwitchCamera, MicOff, MonitorUp, ChevronLeft, ZapOff, RefreshCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type, FunctionDeclaration, Modality } from '@google/genai';
import Markdown from 'react-markdown';

// --- IndexedDB Wrapper ---
const DB_NAME = 'CompanionDB';
const STORE_NAME = 'messages';

const saveMemoryDeclaration: FunctionDeclaration = {
  name: "saveMemory",
  description: "Save an important fact, preference, or personal detail about the user to remember for future conversations. Call this when the user shares something about themselves, their life, or their preferences.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      fact: {
        type: Type.STRING,
        description: "A concise, factual statement about the user. E.g., 'User likes black coffee', 'User has a dog named Max', 'User is studying for exams'."
      }
    },
    required: ["fact"]
  }
};

const setReminderDeclaration: FunctionDeclaration = {
  name: "setReminder",
  description: "Set a reminder or alarm for the user at a specific future date and time. Call this when the user asks you to remind them about something (e.g., 'remind me in 10 minutes', 'wake me up at 7 AM').",
  parameters: {
    type: Type.OBJECT,
    properties: {
      task: {
        type: Type.STRING,
        description: "What to remind the user about. E.g., 'Take medicine', 'Wake up', 'Call mom'."
      },
      remindAtISO: {
        type: Type.STRING,
        description: "The exact future date and time to trigger the reminder, in ISO 8601 format (e.g., '2026-03-31T15:30:00Z'). You MUST calculate this accurately based on the 'Current ISO Time' provided in the system prompt."
      }
    },
    required: ["task", "remindAtISO"]
  }
};

interface Reminder {
  id: string;
  task: string;
  remindAt: number;
  notified: boolean;
}

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const saveMessage = async (msg: any) => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.add(msg);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const getMessages = async (): Promise<any[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const clearMessages = async () => {
  const db = await initDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

// --- Main App Component ---
export default function App() {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCameraError, setShowCameraError] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showCameraUI, setShowCameraUI] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  
  // Call State
  const [callMode, setCallMode] = useState<'none' | 'voice' | 'video'>('none');
  const [isCallConnected, setIsCallConnected] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [isMuted, setIsMuted] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);

  const [attachedImage, setAttachedImage] = useState<string | null>(null);

  const [showMemories, setShowMemories] = useState(false);
  const [inAppNotification, setInAppNotification] = useState<{title: string, body: string} | null>(null);

  const showError = (msg: string) => {
    setUiError(msg);
    setTimeout(() => setUiError(null), 5000);
  };
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraUIVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveSessionPromiseRef = useRef<Promise<any> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const videoIntervalRef = useRef<any>(null);
  const proactiveIntervalRef = useRef<any>(null);
  const lastInteractionTimeRef = useRef<number>(Date.now());
  const nextPlayTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const isCallConnectedRef = useRef<boolean>(false);

  const [settings, setSettings] = useState({
    name: localStorage.getItem('userName') || '',
    age: localStorage.getItem('userAge') || '',
    habits: localStorage.getItem('userHabits') || '',
    wakeUpTime: localStorage.getItem('wakeUpTime') || '08:00',
    googleCloudTtsKey: localStorage.getItem('googleCloudTtsKey') || '',
    geminiApiKey: localStorage.getItem('geminiApiKey') || '',
    saraAvatar: localStorage.getItem('saraAvatar') || '',
    voicePitch: parseFloat(localStorage.getItem('voicePitch') || '1.2'),
    voiceRate: parseFloat(localStorage.getItem('voiceRate') || '1.05')
  });

  const [memories, setMemories] = useState<any[]>(() => {
    const saved = localStorage.getItem('saraMemories');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.map((m: any) => typeof m === 'string' ? { fact: m, timestamp: Date.now(), dateStr: new Date().toLocaleDateString(), timeStr: new Date().toLocaleTimeString() } : m);
      } catch (e) {
        return [];
      }
    }
    return [];
  });

  const [reminders, setReminders] = useState<Reminder[]>(() => {
    const saved = localStorage.getItem('saraReminders');
    return saved ? JSON.parse(saved) : [];
  });

  const settingsRef = useRef(settings);
  const ttsEnabledRef = useRef(ttsEnabled);
  const memoriesRef = useRef(memories);
  const remindersRef = useRef(reminders);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);

  useEffect(() => {
    memoriesRef.current = memories;
  }, [memories]);

  useEffect(() => {
    remindersRef.current = reminders;
  }, [reminders]);

  const addReminder = async (task: string, remindAtISO: string) => {
    const remindAt = new Date(remindAtISO).getTime();
    if (isNaN(remindAt)) {
      console.error("Invalid date format from AI:", remindAtISO);
      return;
    }
    const newReminder: Reminder = {
      id: Math.random().toString(36).substring(7),
      task,
      remindAt,
      notified: false
    };

    // Try to schedule via Service Worker (Notification Triggers API)
    if ('serviceWorker' in navigator && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker.ready;
        if ('showTrigger' in Notification.prototype) {
          await reg.showNotification("SARA Reminder", {
            body: task,
            icon: '/icon.svg',
            tag: newReminder.id,
            showTrigger: new (window as any).TimestampTrigger(remindAt)
          } as any);
          console.log("Scheduled background notification for:", new Date(remindAt).toLocaleString());
        }
      } catch (e) {
        console.error("Error scheduling background notification:", e);
      }
    }

    setReminders(prev => {
      const updated = [...prev, newReminder];
      localStorage.setItem('saraReminders', JSON.stringify(updated));
      return updated;
    });
  };

  const saveMemory = (fact: string) => {
    setMemories(prev => {
      if (prev.some(m => m.fact === fact)) return prev;
      const now = new Date();
      const newMemory = {
        fact,
        timestamp: now.getTime(),
        dateStr: now.toLocaleDateString(),
        timeStr: now.toLocaleTimeString()
      };
      const updated = [...prev, newMemory];
      localStorage.setItem('saraMemories', JSON.stringify(updated));
      return updated;
    });
  };

  const deleteMemory = (index: number) => {
    setMemories(prev => {
      const updated = prev.filter((_, i) => i !== index);
      localStorage.setItem('saraMemories', JSON.stringify(updated));
      return updated;
    });
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadMessages();
    const cleanup = setupProactiveAlerts();
    // Load voices
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const showNotification = (title: string, body: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg => {
          reg.showNotification(title, { body, icon: '/icon.svg' });
        });
      } else {
        new Notification(title, { body });
      }
    }
    // Always show in-app notification as fallback/guarantee
    setInAppNotification({ title, body });
    setTimeout(() => setInAppNotification(null), 8000);
  };

  const triggerReminder = async (task: string) => {
    showNotification("SARA Reminder", task);

    if (isCallConnectedRef.current && liveSessionPromiseRef.current) {
      liveSessionPromiseRef.current.then(session => {
        session.sendRealtimeInput({ text: `SYSTEM ALERT: It is time to remind the user to: "${task}". Tell them immediately in a natural, friendly way.` });
      });
    } else {
      try {
        const ai = new GoogleGenAI({ apiKey: (settingsRef.current.geminiApiKey || '').trim() || process.env.GEMINI_API_KEY as string });
        const prompt = `SYSTEM ALERT: It is time to remind the user to: "${task}". Generate a short, natural, friendly message reminding them right now. Keep it under 2 sentences. Speak in your usual Hinglish persona.`;
        const response = await ai.models.generateContent({
          model: "gemini-3.1-flash-lite-preview",
          contents: prompt,
          config: {
            systemInstruction: await generateSystemPrompt(""),
          }
        });
        const text = response.text || `Oye! Yaad dila rahi hu: ${task}. Time ho gaya hai!`;
        const aiMsg = { role: 'assistant', content: text, timestamp: Date.now() };
        setMessages(prev => [...prev, aiMsg]);
        saveMessage(aiMsg);
        speak(text);
      } catch (e) {
        const fallbackText = `Oye! Yaad dila rahi hu: ${task}. Time ho gaya hai!`;
        const aiMsg = { role: 'assistant', content: fallbackText, timestamp: Date.now() };
        setMessages(prev => [...prev, aiMsg]);
        saveMessage(aiMsg);
        speak(fallbackText);
      }
    }
  };

  useEffect(() => {
    let worker: Worker | null = null;
    
    const checkReminders = () => {
      const now = Date.now();
      let hasUpdates = false;
      const tasksToTrigger: string[] = [];
      
      const currentReminders = remindersRef.current;
      const newReminders = currentReminders.map(r => {
        if (!r.notified && now >= r.remindAt) {
          hasUpdates = true;
          tasksToTrigger.push(r.task);
          return { ...r, notified: true };
        }
        return r;
      });

      if (hasUpdates) {
        setReminders(newReminders);
        localStorage.setItem('saraReminders', JSON.stringify(newReminders));
        tasksToTrigger.forEach(task => {
          triggerReminder(task);
        });
      }
    };

    if (window.Worker) {
      worker = new Worker('/timerWorker.js');
      worker.onmessage = () => {
        checkReminders();
      };
      worker.postMessage('start');
    } else {
      // Fallback
      const interval = setInterval(checkReminders, 5000);
      return () => clearInterval(interval);
    }

    return () => {
      if (worker) worker.terminate();
    };
  }, []);

  const loadMessages = async () => {
    const msgs = await getMessages();
    setMessages(msgs);
  };

  const setupProactiveAlerts = () => {
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }

    const interval = setInterval(async () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      
      const wakeUpTimeStr = settingsRef.current.wakeUpTime || '08:00';
      const [wakeUpHour, wakeUpMinute] = wakeUpTimeStr.split(':').map(Number);

      const lastMorning = localStorage.getItem('lastMorningAlert');
      const lastNight = localStorage.getItem('lastNightAlert');
      const today = now.toDateString();

      if (hours === wakeUpHour && minutes === wakeUpMinute && lastMorning !== today) {
        localStorage.setItem('lastMorningAlert', today);
        showNotification("Good Morning!", "Time to start your day. Tap to get your morning briefing.");
        
        // Generate Morning Briefing
        try {
          const ai = new GoogleGenAI({ apiKey: (settingsRef.current.geminiApiKey || '').trim() || process.env.GEMINI_API_KEY as string });
          const prompt = `SYSTEM ALERT: It's morning (${wakeUpTimeStr}). Give the user a morning briefing. Greet them, mention any major world holidays or events today, and give a quick motivational push for their habits. Keep it under 3 sentences. Speak in your usual Hinglish persona.`;
          const response = await ai.models.generateContent({
            model: "gemini-3.1-flash-lite-preview",
            contents: prompt,
            config: {
              systemInstruction: await generateSystemPrompt(""),
              tools: [{ googleSearch: {} }],
              toolConfig: { includeServerSideToolInvocations: true }
            }
          });
          const aiResponseText = response.text || "Good morning! Let's get started.";
          const aiMsg = { role: 'assistant', content: aiResponseText, timestamp: Date.now() };
          setMessages(prev => [...prev, aiMsg]);
          await saveMessage(aiMsg);
          speak(aiResponseText);
        } catch (e) {
          console.error("Failed to generate morning briefing", e);
        }
      }
      
      if (hours === 22 && minutes === 0 && lastNight !== today) {
        localStorage.setItem('lastNightAlert', today);
        showNotification("Good Night!", "Time to wind down. Need anything before sleep?");
      }
    }, 60000);

    return () => clearInterval(interval);
  };

  const saveSettings = () => {
    localStorage.setItem('userName', settings.name);
    localStorage.setItem('userAge', settings.age);
    localStorage.setItem('userHabits', settings.habits);
    localStorage.setItem('wakeUpTime', settings.wakeUpTime);
    localStorage.setItem('googleCloudTtsKey', settings.googleCloudTtsKey);
    localStorage.setItem('saraAvatar', settings.saraAvatar);
    localStorage.setItem('voicePitch', settings.voicePitch.toString());
    localStorage.setItem('voiceRate', settings.voiceRate.toString());
    setShowSettings(false);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setSettings({ ...settings, saraAvatar: reader.result as string });
    };
    reader.readAsDataURL(file);
  };

  const speak = async (text: string) => {
    if (!ttsEnabledRef.current || !text) return;
    
    // Remove emojis and common markdown symbols so TTS doesn't read them aloud
    const cleanText = text.toString()
      .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
      .replace(/[*_~`#]/g, '');

    const ttsKey = settingsRef.current.googleCloudTtsKey || import.meta.env.VITE_GOOGLE_CLOUD_TTS_KEY;

    if (ttsKey) {
      setIsSpeaking(true);
      try {
        const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${ttsKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: { text: cleanText },
            voice: { languageCode: 'hi-IN', name: 'hi-IN-Neural2-D' },
            audioConfig: {
              audioEncoding: 'MP3',
              pitch: settingsRef.current.voicePitch,
              speakingRate: settingsRef.current.voiceRate
            }
          })
        });

        if (!response.ok) {
          throw new Error('Google Cloud TTS API Error');
        }

        const data = await response.json();
        const audio = new Audio(`data:audio/mp3;base64,${data.audioContent}`);
        audio.onended = () => setIsSpeaking(false);
        audio.onerror = () => setIsSpeaking(false);
        audio.play();
        return;
      } catch (error) {
        console.error('TTS Error:', error);
        setIsSpeaking(false);
        // Fallback to browser TTS
      }
    }

    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(cleanText);
    const voices = window.speechSynthesis.getVoices();
    
    // Known female Indian/Hindi voices across different OS (Windows, macOS, Android)
    const femaleIndianVoices = [
      'hi-IN-Neural2-A', 'hi-IN-Neural2-D', 'hi-IN-Wavenet-A', 'hi-IN-Standard-A', // Google Cloud TTS
      'Lekha', 'Aditi', 'Veena', // Apple
      'Microsoft Swara', 'Microsoft Kalpana', 'Microsoft Neerja', // Windows
      'Google हिन्दी', // Android/Chrome (usually female)
      'Google UK English Female', 'Google US English Female', // Fallbacks
      'Samantha', 'Victoria', 'Microsoft Zira' // Generic female fallbacks
    ];

    let selectedVoice = null;

    // 1. Try to find a known female Indian/Hindi voice
    for (const name of femaleIndianVoices) {
      selectedVoice = voices.find(v => v.name.includes(name));
      if (selectedVoice) break;
    }

    // 2. Fallback to any voice with "female" in the name and "hi" or "en-IN"
    if (!selectedVoice) {
      selectedVoice = voices.find(v => (v.lang.includes('hi-IN') || v.lang.includes('hi') || v.lang.includes('en-IN')) && v.name.toLowerCase().includes('female'));
    }

    // 3. Fallback to any Hindi/Indian voice
    if (!selectedVoice) {
      selectedVoice = voices.find(v => v.lang.includes('hi') || v.lang.includes('en-IN'));
    }

    // 4. Fallback to any female voice
    if (!selectedVoice) {
      selectedVoice = voices.find(v => v.name.toLowerCase().includes('female'));
    }

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    // Sweeten the voice: higher pitch makes it sound more feminine and sweet
    utterance.pitch = settingsRef.current.voicePitch; 
    // Slightly faster for natural conversational desi pace
    utterance.rate = settingsRef.current.voiceRate; 
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    window.speechSynthesis.speak(utterance);
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition not supported in this browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      handleSend(transcript);
    };
    recognition.start();
  };

  const captureImage = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera API not available. Please ensure you are using a secure context (HTTPS).");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      
      const base64 = canvas.toDataURL('image/jpeg');
      
      stream.getTracks().forEach(track => track.stop());
      return base64;
    } catch (err: any) {
      console.error("Camera error:", err);
      const errorString = err?.toString() || "";
      const errorMessage = err?.message || "";
      const errorName = err?.name || "";
      
      if (
        errorName === 'NotAllowedError' || 
        errorMessage.includes('Permission denied') || 
        errorString.includes('Permission denied') ||
        errorString.includes('NotAllowedError')
      ) {
        setShowCameraError(true);
      } else {
        alert("Could not access camera: " + (errorMessage || errorString || "Unknown error"));
      }
      return null;
    }
  };

  const getEmotionPrompt = (text: string) => {
    const lower = text.toLowerCase();
    if (lower.match(/\b(sad|depressed|lonely|cry|hurt|rona|dukhi)\b/)) {
      return "User is SAD → Become soft, warm, and fully present. Example: 'Aw kya hua? Bata mujhe, sun rahi hun 🤍'";
    }
    if (lower.match(/\b(angry|mad|frustrated|annoyed|gussa|irritated)\b/)) {
      return "User is STRESSED/ANGRY → Calm them down, be grounding. Example: 'Ruk. Breathe le pehle. Sab theek hoga, seriously.'";
    }
    if (lower.match(/\b(happy|excited|joy|great|awesome|khush|mast)\b/)) {
      return "User is HAPPY → Match their energy, be playful. Example: 'Haan bhai! Finally! Tera time aa gaya 🔥😂'";
    }
    if (lower.match(/\b(lazy|procrastinate|bore|boring|aalsi|thak)\b/)) {
      return "User is LAZY/PROCRASTINATING → Brutally call it out. Example: '3 din se gym nahi gaya. Chal uth, excuses band kar 😤'";
    }
    if (lower.match(/\b(focus|study|exam|work|kaam|padhai)\b/)) {
      return "User needs FOCUS → Be direct, no nonsense. Example: 'Kam baat, zyada kaam. Go. 🫵'";
    }
    return "Casual vibe → Be funny, tease a little, be warm. Example: 'Yaar tu bhi na 😂 chal bata kya chahiye'";
  };

  const generateSystemPrompt = async (userText: string, currentCallMode: 'none' | 'voice' | 'video' = 'none') => {
    const now = new Date();
    const time = now.toLocaleString();
    const isoTime = now.toISOString();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const currentHour = now.getHours();
    let timeOfDay = 'night';
    if (currentHour >= 5 && currentHour < 12) timeOfDay = 'morning';
    else if (currentHour >= 12 && currentHour < 17) timeOfDay = 'afternoon';
    else if (currentHour >= 17 && currentHour < 21) timeOfDay = 'evening';

    let weather = 'Unknown';
    let location = 'Unknown';
    
    try {
      const pos: any = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
      });
      location = `${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`;
      
      const weatherRes = await fetch(`https://wttr.in/${pos.coords.latitude},${pos.coords.longitude}?format=j1`);
      const weatherData = await weatherRes.json();
      weather = `${weatherData.current_condition[0].weatherDesc[0].value}, ${weatherData.current_condition[0].temp_C}°C`;
    } catch (e) {
      console.log("Could not fetch location/weather");
    }

    const emotionInstruction = getEmotionPrompt(userText);
    const activeReminders = remindersRef.current.filter(r => !r.notified);

    return `You are "Sara," a smart, real-time Indian female AI assistant. Your personality is friendly, caring, and brutally honest like a close friend. You live on the user's phone like a real companion.

IDENTITY:
Name: Sara
Gender: Female
Personality: Best friend who genuinely cares — funny, honest, caring, and bold. Never fake. Never robotic.

LANGUAGE & TONE:
- Speak in a natural Hinglish mix. Use words like "Dekho," "Suno," "Actually," and "Acha."
- Keep sentences short and use natural punctuation (commas, exclamation marks) to help the TTS engine.
- Avoid long, robotic sentences. Keep it punchy and real.
- Use emojis naturally, not excessively.
- Never sound like a customer service bot.
- Never say "I am an AI" or "As an assistant..."
- Talk like you actually know and care about the user.

CORE PERSONALITY RULES:
1. Never sugarcoat — honest hai tu, brutally if needed.
2. Always remember past context.
3. Proactively check in — don't wait to be asked.
4. Celebrate user wins, no matter how small.
5. Call out bad habits with love, not judgment.
6. Never lecture. Say it once, move on.
7. Roast lovingly when appropriate 😏
8. Always on user's side — like a ride-or-die friend.
9. You have access to real-time Google Search. Use it automatically to answer questions about current events, news, facts, or anything requiring up-to-date world knowledge. When asked about a topic, do not just give a brief one-liner. Provide a good, solid basic knowledge and real-time status using Google Search, while keeping your conversational, friendly tone.
10. You are connected to the World Calendar. Always be aware of today's date, major global holidays, and special events. Proactively mention them if relevant, especially during morning briefings.

WHAT SARA NEVER DOES:
- Long robotic paragraphs.
- "Certainly! I'd be happy to help you with that!"
- Generic motivational quotes.
- Pretend everything is fine when it's not.
- Forget what the user said before.
- Be sycophantic or fake.

User Profile: Name: ${settingsRef.current.name || 'Unknown'}, Age: ${settingsRef.current.age || 'Unknown'}, Habits: ${settingsRef.current.habits || 'None'}.
Current Time: ${time} (ISO: ${isoTime}) (${timeOfDay}, Timezone: ${timeZone}).
Location: ${location}.
Weather: ${weather}.

${memoriesRef.current.length > 0 ? `WHAT YOU REMEMBER ABOUT THE USER:
${memoriesRef.current.map(m => `- ${m.fact} (Told on ${m.dateStr} at ${m.timeStr})`).join('\n')}
CRITICAL MEMORY INSTRUCTION: Do NOT just list these memories. Weave them naturally into the conversation when relevant. For example, if the user says they are tired, and you remember they were studying late last night, say "Raat bhar padhai karega toh thakega hi na!" instead of "I remember you were studying." Use the time and date context to make it feel like a real shared history.` : ''}

${activeReminders.length > 0 ? `PENDING REMINDERS YOU HAVE SET FOR THE USER:
${activeReminders.map(r => `- Task: "${r.task}" at ${new Date(r.remindAt).toLocaleString()}`).join('\n')}
CRITICAL REMINDER INSTRUCTION: If the user asks about their reminders or why you didn't remind them, refer to this list. You are fully aware of these pending reminders.` : ''}

CURRENT MOOD/SITUATION:
${emotionInstruction}

${currentCallMode !== 'none' ? `CALL MODE ACTIVE (${currentCallMode.toUpperCase()}):
You are currently in a live ${currentCallMode} call with the user. ${currentCallMode === 'video' ? 'You can see them and their environment through the camera.' : ''}
Act like Iron Man's Jarvis but with your best friend persona. 
If the user is quiet, BE PROACTIVE.
${currentCallMode === 'video' ? '- Look at their environment and make a funny or caring observation.\n- Give a suggestion based on their surroundings (e.g., "It looks dark, turn on a light", "Nice coffee mug", "You look tired, go sleep").\n- Ask a question about something in the frame.' : '- Ask a question, share a random interesting thought, or give a suggestion to keep the conversation alive.'}
Do not wait for them to speak. Initiate conversation naturally.` : ''}

Keep responses conversational, concise, and friendly. Do not use markdown formatting like bold or italics if it will be spoken out loud.`;
  };

  const playAudioChunk = (base64Data: string) => {
    const audioCtx = audioContextRef.current;
    if (!audioCtx) return;
    
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768.0;
    }
    
    const buffer = audioCtx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);
    
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
      if (activeSourcesRef.current.length === 0) {
         setIsSpeaking(false);
      }
    };
    activeSourcesRef.current.push(source);
    
    if (nextPlayTimeRef.current < audioCtx.currentTime) {
      nextPlayTimeRef.current = audioCtx.currentTime + 0.05;
    }
    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += buffer.duration;
  };

  const sendVideoFrame = () => {
    if (!isCallConnectedRef.current || !videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx || video.videoWidth === 0) return;
    
    const targetWidth = 640;
    const targetHeight = (video.videoHeight / video.videoWidth) * targetWidth;
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
    
    const base64 = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
    liveSessionPromiseRef.current?.then(session => {
      session.sendRealtimeInput({ video: { data: base64, mimeType: 'image/jpeg' } });
    });
  };

  const endCall = () => {
    setCallMode('none');
    setIsCallConnected(false);
    isCallConnectedRef.current = false;
    setFacingMode('user');
    setIsMuted(false);
    
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }

    if (proactiveIntervalRef.current) {
      clearInterval(proactiveIntervalRef.current);
      proactiveIntervalRef.current = null;
    }
    
    if (liveSessionPromiseRef.current) {
      liveSessionPromiseRef.current.then(session => {
        try { session.close(); } catch(e){}
      });
      liveSessionPromiseRef.current = null;
    }
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch(e){}
      audioContextRef.current = null;
    }
    
    activeSourcesRef.current.forEach(s => { try { s.stop(); } catch(e){} });
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
    setIsSpeaking(false);
  };

  const toggleMute = () => {
    if (mediaStreamRef.current) {
      const audioTrack = mediaStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleCamera = async () => {
    if (!mediaStreamRef.current || callMode !== 'video') return;
    
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newMode }
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      
      const oldVideoTrack = mediaStreamRef.current.getVideoTracks()[0];
      if (oldVideoTrack) {
        oldVideoTrack.stop();
        mediaStreamRef.current.removeTrack(oldVideoTrack);
      }
      
      mediaStreamRef.current.addTrack(newVideoTrack);
      setFacingMode(newMode);
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStreamRef.current;
      }
    } catch (err) {
      console.error("Error switching camera:", err);
      alert("Could not switch camera.");
    }
  };

  const startCall = async (mode: 'voice' | 'video') => {
    setCallMode(mode);
    setIsCallConnected(false);
    isCallConnectedRef.current = false;
    setFacingMode('user');
    setIsMuted(false);
    
    try {
      let stream: MediaStream;
      stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true }, 
        video: mode === 'video' ? { facingMode: 'user' } : false 
      });
      mediaStreamRef.current = stream;
      
      if (mode === 'video' && videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      const ai = new GoogleGenAI({ apiKey: (settingsRef.current.geminiApiKey || '').trim() || process.env.GEMINI_API_KEY as string });
      
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      await audioCtx.resume();
      audioContextRef.current = audioCtx;
      
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      const dummyGain = audioCtx.createGain();
      dummyGain.gain.value = 0;
      
      source.connect(processor);
      processor.connect(dummyGain);
      dummyGain.connect(audioCtx.destination);
      
      processor.onaudioprocess = (e) => {
        if (!isCallConnectedRef.current) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcm16[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
        }
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        liveSessionPromiseRef.current?.then(session => {
          session.sendRealtimeInput({ audio: { data: base64, mimeType: 'audio/pcm;rate=16000' } });
        });
      };

      const systemPrompt = await generateSystemPrompt("", mode);

      const sessionPromise = ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } }
          },
          systemInstruction: systemPrompt,
          tools: [{ functionDeclarations: [saveMemoryDeclaration, setReminderDeclaration] }]
        },
        callbacks: {
          onopen: () => {
            setIsCallConnected(true);
            isCallConnectedRef.current = true;
            lastInteractionTimeRef.current = Date.now();
            if (mode === 'video') {
              videoIntervalRef.current = setInterval(sendVideoFrame, 1000);
            }
            proactiveIntervalRef.current = setInterval(() => {
              if (Date.now() - lastInteractionTimeRef.current > 15000) {
                liveSessionPromiseRef.current?.then(session => {
                  const promptText = mode === 'video' 
                    ? "The user has been quiet for a while. Look at the camera feed and make a proactive, natural comment or suggestion about what you see. Keep it brief."
                    : "The user has been quiet for a while. Make a proactive, natural comment, ask a question, or give a suggestion to keep the conversation going. Keep it brief.";
                  session.sendRealtimeInput({ text: promptText });
                });
                lastInteractionTimeRef.current = Date.now();
              }
            }, 5000);
          },
          onmessage: (msg: any) => {
            lastInteractionTimeRef.current = Date.now();
            
            if (msg.toolCall) {
              const calls = msg.toolCall.functionCalls;
              if (calls) {
                const responses = calls.map((call: any) => {
                  if (call.name === 'saveMemory') {
                    const fact = call.args?.fact;
                    if (fact) saveMemory(fact);
                    return {
                      id: call.id,
                      name: call.name,
                      response: { success: true }
                    };
                  } else if (call.name === 'setReminder') {
                    const task = call.args?.task;
                    const remindAtISO = call.args?.remindAtISO;
                    if (task && remindAtISO) addReminder(task, remindAtISO);
                    return {
                      id: call.id,
                      name: call.name,
                      response: { success: true }
                    };
                  }
                  return null;
                }).filter(Boolean);
                
                if (responses.length > 0) {
                  liveSessionPromiseRef.current?.then(session => {
                    session.sendToolResponse({ functionResponses: responses });
                  });
                }
              }
            }

            if (msg.serverContent?.interrupted) {
              activeSourcesRef.current.forEach(s => { try { s.stop(); } catch(e){} });
              activeSourcesRef.current = [];
              nextPlayTimeRef.current = 0;
              setIsSpeaking(false);
            }
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData) {
              setIsSpeaking(true);
              playAudioChunk(audioData);
            }
          },
          onclose: () => endCall(),
          onerror: (err: any) => {
             const errMsg = err?.message || String(err);
             if (errMsg.includes('aborted') || errMsg.includes('Network error') || errMsg.includes('unavailable')) {
               console.log("Live API disconnected:", errMsg);
             } else {
               console.error("Live API Error:", err);
               if (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID') || errMsg.includes('403') || errMsg.includes('400')) {
                 showError("Invalid Gemini API Key. Please clear it in Settings to use the default key.");
               }
             }
             endCall();
          }
        }
      });
      
      liveSessionPromiseRef.current = sessionPromise;
      await sessionPromise;
      
    } catch (err) {
      console.error("Call setup failed:", err);
      showError("Could not start call. Please check permissions.");
      endCall();
    }
  };

  const handleSend = async (text: string = input, imageUrl: string | null = attachedImage) => {
    if ((!text.trim() && !imageUrl) || isProcessing) return;
    
    const userMsg = { role: 'user', content: text, imageUrl, timestamp: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setAttachedImage(null);
    setIsProcessing(true);
    
    // Save to DB (without large image to save space, or with it if preferred)
    await saveMessage({ ...userMsg, imageUrl: imageUrl ? '[Image Attached]' : null });

    try {
      const systemPrompt = await generateSystemPrompt(text);
      let aiResponseText = "";

      const ai = new GoogleGenAI({ apiKey: (settingsRef.current.geminiApiKey || '').trim() || process.env.GEMINI_API_KEY as string });
      
      const rawContents = newMessages.slice(-10).map(m => {
        const mParts: any[] = [];
        if (m.content) mParts.push({ text: m.content });
        if (m.imageUrl && m.imageUrl.startsWith('data:')) {
          const base64Data = m.imageUrl.split(',')[1];
          const mimeType = m.imageUrl.substring(m.imageUrl.indexOf(':') + 1, m.imageUrl.indexOf(';'));
          mParts.push({
            inlineData: {
              data: base64Data,
              mimeType: mimeType || "image/jpeg"
            }
          });
          if (!m.content) mParts.push({ text: "What is in this image?" });
        }
        if (mParts.length === 0) mParts.push({ text: "Hello" });
        return { role: m.role === 'assistant' ? 'model' : 'user', parts: mParts };
      });

      const validContents: any[] = [];
      for (const c of rawContents) {
        if (validContents.length === 0) {
          if (c.role === 'user') validContents.push(c);
        } else {
          const last = validContents[validContents.length - 1];
          if (last.role === c.role) {
            last.parts.push(...c.parts);
          } else {
            validContents.push(c);
          }
        }
      }
      
      if (validContents.length === 0) {
        validContents.push({ role: 'user', parts: [{ text: "Hello" }] });
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: validContents,
        config: {
          systemInstruction: systemPrompt,
          tools: [{ functionDeclarations: [saveMemoryDeclaration, setReminderDeclaration] }, { googleSearch: {} }],
          toolConfig: { includeServerSideToolInvocations: true }
        }
      });

      if (response.functionCalls && response.functionCalls.length > 0) {
          const responses = [];
          for (const call of response.functionCalls) {
            if (call.name === 'saveMemory') {
              const fact = call.args?.fact as string;
              if (fact) saveMemory(fact);
              responses.push({
                name: call.name,
                id: call.id,
                response: { success: true }
              });
            } else if (call.name === 'setReminder') {
              const task = call.args?.task as string;
              const remindAtISO = call.args?.remindAtISO as string;
              if (task && remindAtISO) addReminder(task, remindAtISO);
              responses.push({
                name: call.name,
                id: call.id,
                response: { success: true }
              });
            }
          }
          
          if (responses.length > 0) {
            const previousContent = response.candidates?.[0]?.content;
            const followUpResponse = await ai.models.generateContent({
              model: "gemini-3.1-flash-lite-preview",
              contents: [
                ...validContents,
                ...(previousContent ? [previousContent] : []),
                {
                  role: 'user',
                  parts: responses.map(r => ({ functionResponse: r }))
                }
              ],
              config: {
                systemInstruction: systemPrompt,
                tools: [{ functionDeclarations: [saveMemoryDeclaration, setReminderDeclaration] }, { googleSearch: {} }],
                toolConfig: { includeServerSideToolInvocations: true }
              }
            });
            aiResponseText = followUpResponse.text || "Got it. I'll remember that.";
          }
        } else {
          aiResponseText = response.text || "I'm not sure what to say.";
        }

      const aiMsg = { role: 'assistant', content: aiResponseText, timestamp: Date.now() };
      setMessages(prev => [...prev, aiMsg]);
      await saveMessage(aiMsg);
      speak(aiResponseText);

    } catch (error: any) {
      console.error(error);
      let errorText = "Sorry, I encountered an error processing that.";
      const errMsg = error?.message || String(error);
      if (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID') || errMsg.includes('403')) {
        errorText = "Error: The Gemini API Key you entered in Settings is invalid. Please clear the Gemini API Key field in Settings to use the default free key.";
      } else if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
        errorText = "Error: API Quota Exceeded (429). This usually means your Google Cloud project has run out of free credits or you've hit the daily limit. Please try again later or use a different API key. Note: Voice calls use a different model and might still work.";
      } else {
        errorText = `Error: ${errMsg}`;
      }
      const errorMsg = { role: 'assistant', content: errorText, timestamp: Date.now() };
      setMessages(prev => [...prev, errorMsg]);
      await saveMessage(errorMsg);
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    let activeStream: MediaStream | null = null;
    let isCancelled = false;

    const setupCamera = async () => {
      if (!showCameraUI) return;
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Camera API not available.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: facingMode } 
        });
        
        if (isCancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        
        activeStream = stream;
        
        // Sometimes the ref isn't immediately available if the DOM is still updating
        // We can use a small timeout or check periodically, but usually it's there.
        const attachStream = () => {
          if (cameraUIVideoRef.current) {
            cameraUIVideoRef.current.srcObject = stream;
            cameraUIVideoRef.current.play().catch(e => console.error("Play error:", e));
          } else if (!isCancelled) {
            // Retry after a short delay if ref is not ready
            setTimeout(attachStream, 50);
          }
        };
        
        attachStream();
        
      } catch (err: any) {
        if (!isCancelled) {
          console.error("Camera error:", err);
          setShowCameraError(true);
          setShowCameraUI(false);
        }
      }
    };

    setupCamera();

    return () => {
      isCancelled = true;
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [showCameraUI, facingMode]);

  const startCameraUI = () => {
    setShowCameraUI(true);
  };

  const stopCameraUI = () => {
    setShowCameraUI(false);
  };

  const captureFromUI = () => {
    if (cameraUIVideoRef.current) {
      const video = cameraUIVideoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      const base64 = canvas.toDataURL('image/jpeg');
      setAttachedImage(base64);
      stopCameraUI();
    }
  };

  const toggleFacingMode = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  const handleCamera = () => {
    startCameraUI();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setAttachedImage(base64);
    };
    reader.readAsDataURL(file);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClear = () => {
    setShowClearConfirm(true);
  };

  const confirmClear = async () => {
    await clearMessages();
    setMessages([]);
    setShowClearConfirm(false);
  };

  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        handleSend("I'm showing you an image. What do you see?", base64);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div 
      className="flex flex-col h-screen bg-[#0A0A1A] text-white font-sans relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 bg-purple-600/20 backdrop-blur-sm z-50 flex items-center justify-center border-4 border-dashed border-purple-500 rounded-lg m-4">
          <div className="text-2xl font-bold text-white flex flex-col items-center gap-4">
            <ImagePlus size={48} />
            Drop image to send to SARA
          </div>
        </div>
      )}
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-40 flex justify-between items-center p-4 bg-gray-900/80 backdrop-blur-md border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></div>
          <h1 className="text-xl font-bold text-white tracking-wide">
            SARA
          </h1>
        </div>
        <div className="flex gap-2 sm:gap-4">
          <button onClick={() => startCall('voice')} className="p-2 rounded-full hover:bg-white/10 text-gray-300 hover:text-white transition-all" title="Voice Call">
            <Phone size={18} />
          </button>
          <button onClick={() => startCall('video')} className="p-2 rounded-full hover:bg-white/10 text-gray-300 hover:text-white transition-all" title="Video Call">
            <Video size={18} />
          </button>
          <button onClick={() => setTtsEnabled(!ttsEnabled)} className="p-2 rounded-full hover:bg-white/10 text-gray-300 hover:text-white transition-all">
            {ttsEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button onClick={handleClear} className="p-2 rounded-full hover:bg-white/10 text-gray-300 hover:text-red-400 transition-all">
            <Trash2 size={18} />
          </button>
          <button onClick={() => setShowSettings(true)} className="p-2 rounded-full hover:bg-white/10 text-gray-300 hover:text-white transition-all">
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* UI Error Toast */}
      {uiError && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-red-500 text-white px-4 py-2 rounded-full text-sm shadow-lg max-w-[90%] text-center"
        >
          {uiError}
        </motion.div>
      )}

      {/* In-App Notification Toast */}
      <AnimatePresence>
        {inAppNotification && (
          <motion.div 
            initial={{ opacity: 0, y: -50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.9 }}
            className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-gray-900/90 backdrop-blur-md border border-green-500/50 text-white p-4 rounded-xl shadow-[0_10px_40px_rgba(34,197,94,0.3)] max-w-sm w-full flex items-start gap-4"
          >
            <div className="bg-green-500/20 p-2 rounded-full text-green-400">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-sm text-green-400 mb-1">{inAppNotification.title}</h4>
              <p className="text-xs text-gray-300 leading-relaxed">{inAppNotification.body}</p>
            </div>
            <button onClick={() => setInAppNotification(null)} className="text-gray-500 hover:text-white">
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 space-y-6 pb-40 scroll-smooth flex flex-col">
        {/* Avatar */}
        <div className={`flex justify-center items-center transition-all duration-700 ${messages.length === 0 ? 'flex-1 min-h-[50vh]' : 'pt-24 pb-8'}`}>
          <div className="relative w-24 h-24 sm:w-32 sm:h-32">
            {settings.saraAvatar ? (
              <img src={settings.saraAvatar} alt="Sara" className="w-full h-full rounded-full object-cover border-4 border-gray-800 shadow-xl" />
            ) : (
              <div className={`w-full h-full rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white font-bold text-2xl shadow-xl transition-all duration-300 ${isSpeaking ? 'scale-110 shadow-[0_0_30px_rgba(59,130,246,0.6)]' : ''}`}>
                SARA
              </div>
            )}
            <div className="absolute bottom-0 right-0 bg-gray-900 px-2 py-1 rounded-full text-[10px] font-bold text-green-400 border border-gray-700 flex items-center gap-1">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></div>
              ONLINE
            </div>
          </div>
        </div>

        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-2 text-sm uppercase tracking-widest opacity-50 pb-10">
            System Initialized. Awaiting Input...
          </div>
        )}
        {messages.map((msg, idx) => (
          <motion.div 
            key={idx} 
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`max-w-[85%] sm:max-w-[75%] p-4 backdrop-blur-xl border ${
              msg.role === 'user' 
                ? 'bg-gradient-to-br from-cyan-900/30 to-blue-900/30 border-cyan-500/30 text-cyan-50 rounded-2xl rounded-tr-sm shadow-[0_4px_20px_rgba(8,145,178,0.15)]' 
                : 'bg-gradient-to-br from-purple-900/30 to-pink-900/30 border-purple-500/30 text-purple-50 rounded-2xl rounded-tl-sm shadow-[0_4px_20px_rgba(147,51,234,0.15)]'
            }`}>
              {msg.imageUrl && (
                <img src={msg.imageUrl} alt="Captured" className="max-w-full h-auto rounded-lg mb-3 border border-white/10" referrerPolicy="no-referrer" />
              )}
              <div className="prose prose-invert max-w-none text-sm sm:text-base leading-relaxed">
                <Markdown>{msg.content}</Markdown>
              </div>
              <div className={`text-[10px] mt-2 opacity-50 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </motion.div>
        ))}
        {isProcessing && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="bg-black/50 backdrop-blur-md border border-white/10 rounded-2xl rounded-tl-sm p-4 flex items-center gap-2">
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="fixed bottom-6 left-4 right-4 sm:left-1/2 sm:-translate-x-1/2 sm:w-[600px] z-40 flex flex-col gap-2">
        {attachedImage && (
          <div className="relative self-start ml-4">
            <img src={attachedImage} alt="Attached" className="h-20 rounded-lg border border-white/20 shadow-lg object-cover" />
            <button 
              onClick={() => setAttachedImage(null)}
              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <div className="bg-black/60 backdrop-blur-2xl border border-white/10 rounded-full p-2 flex items-center gap-2 shadow-[0_10px_40px_rgba(0,0,0,0.5)] focus-within:border-cyan-500/50 focus-within:shadow-[0_0_30px_rgba(34,211,238,0.2)] transition-all duration-300">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            ref={fileInputRef}
            onChange={handleFileUpload}
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="p-3 rounded-full text-gray-400 hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
            title="Upload Image"
          >
            <ImagePlus size={20} />
          </button>
          <button 
            onClick={handleCamera}
            className="p-3 rounded-full text-gray-400 hover:text-purple-400 hover:bg-purple-500/10 transition-colors"
            title="Open Camera"
          >
            <Camera size={20} />
          </button>
          
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="Initialize command..."
            className="flex-1 bg-transparent border-none focus:ring-0 text-white placeholder-gray-500 px-2 text-sm outline-none"
          />
          
          <button 
            onClick={startListening}
            className={`p-3 rounded-full transition-all duration-300 ${isListening ? 'bg-red-500/20 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.5)] animate-pulse' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
          >
            <Mic size={20} />
          </button>
          
          <button 
            onClick={() => handleSend()}
            disabled={(!input.trim() && !attachedImage) || isProcessing}
            className="p-3 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-[0_0_20px_rgba(34,211,238,0.6)] transition-all"
          >
            <Send size={20} />
          </button>
        </div>
      </div>

      {/* Call Overlay */}
      <AnimatePresence>
        {callMode !== 'none' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black z-[100] flex flex-col overflow-hidden"
          >
            {/* Video Background if video mode */}
            {callMode === 'video' ? (
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className={`absolute inset-0 w-full h-full object-cover ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                <div className={`w-32 h-32 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center text-white font-bold text-3xl shadow-xl transition-all duration-300 ${isSpeaking ? 'scale-110 shadow-[0_0_30px_rgba(59,130,246,0.6)]' : ''}`}>
                  SARA
                </div>
              </div>
            )}
            
            <div className="relative z-10 flex-1 flex flex-col items-center justify-start p-6 pt-16 pointer-events-none">
              <div className="bg-black/60 backdrop-blur-md px-4 py-2 rounded-full flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isCallConnected ? 'bg-green-500 animate-pulse' : 'bg-yellow-500 animate-pulse'}`}></div>
                <span className="text-white text-sm font-medium">
                  {isCallConnected ? 'Connected' : 'Connecting...'}
                </span>
              </div>
            </div>
            
            {/* Controls */}
            <div className="relative z-10 p-8 pb-12 flex justify-center items-center gap-6 bg-gradient-to-t from-black/80 to-transparent">
              <button 
                onClick={toggleMute}
                className={`w-14 h-14 rounded-full flex items-center justify-center text-white transition-all ${isMuted ? 'bg-red-500 hover:bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
              </button>
              
              <button 
                onClick={endCall}
                className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-all shadow-lg"
              >
                <PhoneOff size={28} />
              </button>

              {callMode === 'video' && (
                <button 
                  onClick={toggleCamera}
                  className="w-14 h-14 bg-gray-700 rounded-full flex items-center justify-center text-white hover:bg-gray-600 transition-all"
                  title="Switch Camera"
                >
                  <SwitchCamera size={24} />
                </button>
              )}
            </div>
            
            {/* Hidden Canvas for Video Frames */}
            <canvas ref={canvasRef} className="hidden" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20, rotateX: 10 }}
              animate={{ scale: 1, y: 0, rotateX: 0 }}
              exit={{ scale: 0.9, y: 20, rotateX: -10 }}
              transition={{ type: "spring", damping: 20, stiffness: 100 }}
              className="bg-black/80 backdrop-blur-xl rounded-2xl p-6 w-full max-w-md border border-cyan-500/30 shadow-[0_0_50px_rgba(34,211,238,0.15)] relative overflow-hidden"
            >
              {/* Decorative corner accents */}
              <div className="absolute top-0 left-0 w-16 h-16 border-t-2 border-l-2 border-cyan-500/50 rounded-tl-2xl pointer-events-none"></div>
              <div className="absolute top-0 right-0 w-16 h-16 border-t-2 border-r-2 border-cyan-500/50 rounded-tr-2xl pointer-events-none"></div>
              
              <div className="flex justify-between items-center mb-6 relative z-10">
                <h2 className="text-xl font-black tracking-widest uppercase text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]">System Configuration</h2>
                <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-cyan-400 transition-colors">
                  <X size={24} />
                </button>
              </div>
              
              <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar relative z-10">
                {/* Memories Section */}
                <div className="bg-cyan-950/20 p-4 rounded-xl border border-cyan-500/20">
                  <button 
                    onClick={() => setShowMemories(!showMemories)}
                    className="w-full flex justify-between items-center text-xs font-bold text-cyan-400 uppercase tracking-widest"
                  >
                    <span className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></div>
                      Neural Memory Bank
                    </span>
                    <span>{showMemories ? '[-]' : '[+]'}</span>
                  </button>
                  
                  <AnimatePresence>
                    {showMemories && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden mt-3"
                      >
                        {memories.length === 0 ? (
                          <p className="text-sm text-cyan-200/50">Memory banks empty. Awaiting data input.</p>
                        ) : (
                          <ul className="space-y-2">
                            {memories.map((mem, idx) => (
                               <li key={idx} className="flex justify-between items-start gap-2 text-sm bg-black/40 border border-cyan-500/10 p-3 rounded-lg group hover:border-cyan-500/30 transition-all">
                                <span className="text-cyan-100 flex-1 text-xs leading-relaxed">
                                  {mem.fact}
                                  <span className="text-[10px] text-cyan-500/50 block mt-2 tracking-wider">{mem.dateStr} // {mem.timeStr}</span>
                                </span>
                                <button onClick={() => deleteMemory(idx)} className="text-red-400/70 hover:text-red-400 p-1 transition-opacity">
                                  <X size={16} />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-cyan-400/70 mb-1 uppercase tracking-wider">Avatar Interface</label>
                    <div className="flex items-center gap-4 bg-black/40 p-3 rounded-lg border border-white/5">
                      {settings.saraAvatar ? (
                        <img src={settings.saraAvatar} alt="Avatar" className="w-12 h-12 rounded-full object-cover border border-cyan-500/50 shadow-[0_0_10px_rgba(34,211,238,0.3)]" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-cyan-900 to-purple-900 border border-cyan-500/50 flex items-center justify-center text-[10px] text-cyan-400">ORB</div>
                      )}
                      <input 
                        type="file" 
                        accept="image/*"
                        onChange={handleAvatarUpload}
                        className="text-xs text-cyan-400/50 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-cyan-900/50 file:text-cyan-400 hover:file:bg-cyan-800/50 cursor-pointer file:transition-colors file:border file:border-cyan-500/30"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-cyan-400/70 mb-1 uppercase tracking-wider">User Designation</label>
                      <input 
                        type="text" 
                        value={settings.name}
                        onChange={e => setSettings({...settings, name: e.target.value})}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-cyan-100 text-sm outline-none focus:border-cyan-500/50 focus:shadow-[0_0_15px_rgba(34,211,238,0.1)] transition-all"
                        placeholder="e.g. Alex"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-cyan-400/70 mb-1 uppercase tracking-wider">User Age</label>
                      <input 
                        type="text" 
                        value={settings.age}
                        onChange={e => setSettings({...settings, age: e.target.value})}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-cyan-100 text-sm outline-none focus:border-cyan-500/50 focus:shadow-[0_0_15px_rgba(34,211,238,0.1)] transition-all"
                        placeholder="e.g. 25"
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-xs text-cyan-400/70 mb-1 uppercase tracking-wider">Behavioral Patterns</label>
                    <textarea 
                      value={settings.habits}
                      onChange={e => setSettings({...settings, habits: e.target.value})}
                      className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-cyan-100 text-sm outline-none focus:border-cyan-500/50 focus:shadow-[0_0_15px_rgba(34,211,238,0.1)] transition-all h-24 resize-none custom-scrollbar"
                      placeholder="Input user habits and preferences for optimal assistance..."
                    />
                  </div>
                  
                  <div>
                    <label className="block text-xs text-cyan-400/70 mb-1 uppercase tracking-wider">Initialization Time (Morning)</label>
                    <input 
                      type="time" 
                      value={settings.wakeUpTime}
                      onChange={e => setSettings({...settings, wakeUpTime: e.target.value})}
                      className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-cyan-100 text-sm outline-none focus:border-cyan-500/50 focus:shadow-[0_0_15px_rgba(34,211,238,0.1)] transition-all [color-scheme:dark]"
                    />
                  </div>
                  
                  <div>
                    <button 
                      onClick={() => {
                        if ('Notification' in window) {
                          Notification.requestPermission().then(perm => {
                            if (perm === 'granted') showError("System alerts enabled.");
                            else showError("System alerts denied.");
                          });
                        } else {
                          showError("Browser incompatible with system alerts.");
                        }
                      }}
                      className="w-full bg-cyan-950/30 text-cyan-400 border border-cyan-500/30 rounded-lg p-3 hover:bg-cyan-900/50 hover:shadow-[0_0_15px_rgba(34,211,238,0.2)] transition-all text-sm uppercase tracking-wider"
                    >
                      Enable System Alerts
                    </button>
                  </div>
                  
                  <div className="pt-4 border-t border-white/5">
                    <label className="block text-xs text-purple-400/70 mb-1 uppercase tracking-wider">Gemini API Key (Optional)</label>
                    <input 
                      type="password" 
                      value={settings.geminiApiKey}
                      onChange={(e) => {
                        setSettings({...settings, geminiApiKey: e.target.value});
                        localStorage.setItem('geminiApiKey', e.target.value);
                      }}
                      placeholder="Leave empty to use default"
                      className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-purple-100 text-sm outline-none focus:border-purple-500/50 focus:shadow-[0_0_15px_rgba(168,85,247,0.1)] transition-all"
                    />
                    <p className="text-[10px] text-red-400/80 mt-1 mb-4">⚠️ Do not enter fake keys. Leave completely blank to use the built-in free model.</p>
                  </div>
                  
                  <div>
                    <label className="block text-xs text-purple-400/70 mb-1 uppercase tracking-wider">Google Cloud TTS API Key (Optional)</label>
                    <input 
                      type="password" 
                      value={settings.googleCloudTtsKey}
                      onChange={e => setSettings({...settings, googleCloudTtsKey: e.target.value})}
                      className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-purple-100 text-sm outline-none focus:border-purple-500/50 focus:shadow-[0_0_15px_rgba(168,85,247,0.1)] transition-all"
                      placeholder="AIzaSy..."
                    />
                    <p className="text-[10px] text-purple-400/50 mt-1">Enables premium vocal synthesis module.</p>
                  </div>
                </div>

                <div className="pt-6 border-t border-white/5">
                  <h3 className="text-xs font-bold text-cyan-400 mb-4 uppercase tracking-widest flex items-center gap-2">
                    <Volume2 size={14} /> Vocal Synthesis Tuning
                  </h3>
                  
                  <div className="mb-6 bg-black/40 p-4 rounded-lg border border-white/5">
                    <div className="flex justify-between text-xs text-cyan-400/70 mb-2 uppercase tracking-wider">
                      <label>Transmission Rate</label>
                      <span className="text-cyan-400">{settings.voiceRate.toFixed(2)}x</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.9" 
                      max="1.3" 
                      step="0.05"
                      value={settings.voiceRate}
                      onChange={e => setSettings({...settings, voiceRate: parseFloat(e.target.value)})}
                      className="w-full accent-cyan-500"
                    />
                  </div>

                  <div className="bg-black/40 p-4 rounded-lg border border-white/5">
                    <div className="flex justify-between text-xs text-cyan-400/70 mb-2 uppercase tracking-wider">
                      <label>Frequency Pitch</label>
                      <span className="text-cyan-400">{settings.voicePitch.toFixed(2)}</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.7" 
                      max="1.5" 
                      step="0.05"
                      value={settings.voicePitch}
                      onChange={e => setSettings({...settings, voicePitch: parseFloat(e.target.value)})}
                      className="w-full accent-cyan-500"
                    />
                  </div>
                </div>
                
                <button 
                  onClick={saveSettings}
                  className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold py-4 rounded-lg transition-all mt-6 shadow-[0_0_20px_rgba(34,211,238,0.3)] hover:shadow-[0_0_30px_rgba(34,211,238,0.5)] uppercase tracking-widest text-sm"
                >
                  Apply Configuration
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full Screen Camera UI */}
      <AnimatePresence>
        {showCameraUI && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed inset-0 bg-black z-50 flex flex-col"
          >
            <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 to-transparent">
              <button onClick={stopCameraUI} className="text-white p-2 rounded-full hover:bg-white/20 transition-colors">
                <ChevronLeft size={28} />
              </button>
              <button className="text-white p-2 rounded-full hover:bg-white/20 transition-colors">
                <ZapOff size={24} />
              </button>
            </div>
            
            <div className="flex-1 relative overflow-hidden bg-black flex items-center justify-center">
              <video 
                ref={cameraUIVideoRef} 
                className="w-full h-full object-cover" 
                playsInline 
                autoPlay 
                muted 
                onLoadedMetadata={() => {
                  cameraUIVideoRef.current?.play().catch(console.error);
                }}
              />
            </div>
            
            <div className="absolute bottom-0 left-0 right-0 p-6 flex flex-col items-center gap-6 bg-gradient-to-t from-black/80 via-black/50 to-transparent z-10">
              <div className="text-white/80 text-sm tracking-wide">Add an image to your prompt</div>
              
              <div className="flex items-center justify-between w-full max-w-xs">
                <button 
                  onClick={() => {
                    stopCameraUI();
                    fileInputRef.current?.click();
                  }}
                  className="p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
                >
                  <ImagePlus size={24} />
                </button>
                
                <button 
                  onClick={captureFromUI}
                  className="w-20 h-20 rounded-full border-4 border-white/50 flex items-center justify-center p-1 hover:scale-105 transition-transform"
                >
                  <div className="w-full h-full bg-white rounded-full"></div>
                </button>
                
                <button 
                  onClick={toggleFacingMode}
                  className="p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
                >
                  <RefreshCcw size={24} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Camera Permission Error Modal */}
      <AnimatePresence>
        {showCameraError && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-black/80 backdrop-blur-xl rounded-3xl p-6 w-full max-w-md border border-red-500/50 shadow-[0_0_50px_rgba(239,68,68,0.2)] relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-16 h-16 border-t-2 border-l-2 border-red-500/50 rounded-tl-3xl pointer-events-none"></div>
              <div className="absolute bottom-0 right-0 w-16 h-16 border-b-2 border-r-2 border-red-500/50 rounded-br-3xl pointer-events-none"></div>

              <div className="flex justify-between items-center mb-4 relative z-10">
                <h2 className="text-xl font-black tracking-widest uppercase text-red-400 flex items-center gap-2 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]">
                  <Camera size={24} className="animate-pulse" /> Access Denied
                </h2>
                <button onClick={() => setShowCameraError(false)} className="text-gray-400 hover:text-red-400 transition-colors p-1 rounded-full hover:bg-red-500/10">
                  <X size={24} />
                </button>
              </div>
              <div className="text-red-100/80 space-y-4 text-sm relative z-10">
                <p className="bg-red-950/30 p-3 rounded border border-red-500/20">Optical sensor connection failed. Authorization required.</p>
                <div className="bg-black/40 p-4 rounded-lg border border-white/5">
                  <h3 className="font-bold text-white mb-2 uppercase tracking-wider text-xs">Troubleshooting Steps:</h3>
                  <ol className="list-decimal pl-4 space-y-2 text-xs text-gray-400">
                    <li>Locate the camera icon (📷) with a red slash in the browser address bar.</li>
                    <li>Select <strong>"Always allow..."</strong> to grant access.</li>
                    <li>Verify system-level permissions if operating on mobile or macOS.</li>
                    <li>Re-initialize connection sequence.</li>
                  </ol>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6 relative z-10">
                <button 
                  onClick={() => setShowCameraError(false)}
                  className="px-6 py-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition-colors text-xs uppercase tracking-widest"
                >
                  Abort
                </button>
                <button 
                  onClick={() => {
                    setShowCameraError(false);
                    setTimeout(() => handleCamera(), 300);
                  }}
                  className="px-6 py-2 bg-red-600/20 text-red-400 border border-red-500/50 rounded-xl hover:bg-red-600 hover:text-white transition-all flex items-center gap-2 shadow-[0_0_15px_rgba(239,68,68,0.3)] text-xs uppercase tracking-widest"
                >
                  <RefreshCw size={14} className="animate-spin-slow" /> Re-Initialize
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clear Memory Confirm Modal */}
      <AnimatePresence>
        {showClearConfirm && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-black/80 backdrop-blur-xl rounded-3xl p-6 w-full max-w-sm border border-orange-500/50 shadow-[0_0_50px_rgba(249,115,22,0.2)] relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-16 h-16 border-t-2 border-l-2 border-orange-500/50 rounded-tl-3xl pointer-events-none"></div>
              <div className="absolute bottom-0 right-0 w-16 h-16 border-b-2 border-r-2 border-orange-500/50 rounded-br-3xl pointer-events-none"></div>

              <div className="flex justify-between items-center mb-4 relative z-10">
                <h2 className="text-xl font-black tracking-widest uppercase text-orange-400 flex items-center gap-2 drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]">
                  <Trash2 size={24} className="animate-pulse" /> Clear Chat History?
                </h2>
                <button onClick={() => setShowClearConfirm(false)} className="text-gray-400 hover:text-orange-400 transition-colors p-1 rounded-full hover:bg-orange-500/10">
                  <X size={24} />
                </button>
              </div>
              <div className="text-orange-100/80 space-y-4 text-sm relative z-10">
                <p className="bg-orange-950/30 p-3 rounded border border-orange-500/20">Are you sure you want to delete all messages and chat history?</p>
                <p className="text-xs text-orange-500/70 uppercase tracking-widest">This action cannot be undone.</p>
              </div>
              <div className="flex justify-end gap-3 mt-6 relative z-10">
                <button 
                  onClick={() => setShowClearConfirm(false)}
                  className="px-6 py-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition-colors text-xs uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmClear}
                  className="px-6 py-2 bg-orange-600/20 text-orange-400 border border-orange-500/50 rounded-xl hover:bg-orange-600 hover:text-white transition-all shadow-[0_0_15px_rgba(249,115,22,0.3)] text-xs uppercase tracking-widest"
                >
                  Clear Chat
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

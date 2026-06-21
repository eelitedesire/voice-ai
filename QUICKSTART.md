# Sanuvia Frontend - Quick Start Guide

## 🚀 Start the Application

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## 🎨 Testing the New UI

### 1. Theme Toggle
- Click the **Sun/Moon icon** in the top-right header
- Verify smooth transition between light and dark mode
- Check that preference persists on page reload

### 2. Speaker Enrollment Tab
1. Click **"Enroll Speakers"** tab
2. Enter a speaker name (e.g., "Alice")
3. Click **"Record Voice Sample"**
4. Speak for 10-15 seconds
5. Click **"Stop"** when done
6. Verify enrollment card appears with avatar and sample count
7. Repeat for a second speaker (e.g., "Bob")

### 3. Live Session Tab
1. Click **"Live Session"** tab
2. Click the large **"Start Session"** button
3. **Verify Live HUD displays:**
   - VU Meter showing audio levels (12 animated bars)
   - Accuracy Bar with confidence percentage
   - Speaker Chips showing enrolled speakers
   - Connection status shows "Live" with green dot

### 4. Real-time Transcription
1. With session recording, speak as the enrolled speakers
2. **Verify:**
   - Partial transcript appears with shimmer effect and blinking caret
   - Final transcript "hardens" into colored bubble with speaker name
   - Consecutive turns from same speaker group together
   - Speaker confidence badge shows percentage
   - Auto-scroll keeps latest message visible

### 5. Jump to Live
1. Scroll up in the transcript
2. Verify **"Jump to live"** button appears (bottom-right)
3. Click it to scroll back to latest message

### 6. Conversation Analytics
1. Stop the session
2. Click **"Show Conversation Analytics"**
3. **Verify charts display:**
   - Talk Time Distribution (horizontal bars per speaker)
   - Turn Taking Timeline (colored ribbon)
   - Word counts and turn statistics

### 7. Animations & Polish
- **Tab switching** - Smooth animated indicator
- **Recording button** - Pulsing border when active
- **Speaker chips** - Pulse animation on active speaker
- **Pending bubble** - Shimmer effect for live text
- **Empty states** - Microphone icon with helpful text
- All transitions should be smooth 60fps

## 🎯 Key Visual Checks

### Color System
- ✅ 8 deterministic speaker colors (blue, purple, pink, orange, green, teal, amber, red)
- ✅ Same speaker always gets same color
- ✅ Colors work in both light and dark mode

### Typography
- ✅ Inter font loaded throughout
- ✅ Clear hierarchy: headings, body, labels, captions

### Spacing
- ✅ Consistent 8px grid
- ✅ Generous whitespace, not cramped

### Glass Effect
- ✅ Header has subtle blur/transparency

### Elevation
- ✅ Cards have soft shadows
- ✅ Buttons have hover states
- ✅ Focus rings on interactive elements

## 🔧 Troubleshooting

### WebSocket Not Connecting
- Ensure backend is running with WebSocket support at `ws://localhost:3000/ws/transcribe`
- Check console for connection errors

### No Audio Levels
- Grant microphone permissions in browser
- Check if VU Meter bars animate when speaking

### Speakers Not Identified
- Enroll at least 2 speakers with 10+ second samples
- Speak clearly during enrollment
- Re-record if confidence is low (<60%)

### Dark Mode Not Working
- Check browser console for errors
- Verify localStorage has 'theme' key
- Try manual toggle in header

## 📱 Responsive Testing

Test on different viewports:
- **Desktop** (1920x1080) - Full layout with all panels
- **Tablet** (768x1024) - Should remain functional
- **Mobile** (375x667) - Stacked layout

## ✅ Success Criteria

You should see:
1. ✨ Professional, polished UI (Linear/Otter quality)
2. 🎨 Smooth 60fps animations
3. 🌓 Working light/dark mode
4. 🎙️ Real-time VU meter
5. 💬 Chat-style transcript with speaker colors
6. 📊 Analytics charts after session
7. 🎯 No layout shift during streaming
8. ♿ Keyboard navigation works

## 🐛 Known Issues

None currently - all core functionality preserved from original implementation.

## 📚 Component Documentation

See `FRONTEND_REDESIGN.md` for complete technical documentation.

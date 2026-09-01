# Qwen Coder Environment Setup - Ashes Beyond Light

## 🎯 Project Overview

This is a VVD (Virtual World Development) app featuring a 3D interactive solar system map. You're continuing development from where Claude left off.

**GitHub Repository**: [Add your repo URL here after publishing]

## 📦 Initial Setup

```bash
# Clone the repository
git clone <YOUR_GITHUB_REPO_URL>
cd scifi-theme

# Install dependencies
npm install

# Start VVD development server
vvd run
```

## 🔧 Development Environment

- **Language**: TypeScript/React
- **Framework**: VVD SDK
- **3D Engine**: Three.js (imported dynamically)
- **Build Tool**: VVD CLI
- **Hot Reload**: Automatic when editing `src/` files

## 📁 Key Files to Work With

### Primary Code
- **`src/app.tsx`** (2509 lines) - Main application, solar system renderer, all logic
- **`vvd.json`** - VVD manifest configuration
- **`roadmap.md`** - Feature tracking and status

### Supporting Files
- **`AGENTS.md`** - VVD development principles and guidelines
- **`docs/`** - VVD SDK documentation and best practices
- **`ABL 3D Models/`** - 3D assets (.glb files)

## 🚧 Current State & Issues

### ✅ Working Features
1. **Dense Dyson Swarm** - 3 rings, 660 satellites around sun (lines 1324-1361)
2. **Touch Controls** - Single finger rotate, two-finger pinch zoom (lines 1670-1725)
3. **Tier Region Highlighting** - Click tier labels to highlight space regions (lines 2013-2031)
4. **Pause/Resume Animation** - Button toggles orbital motion (lines 1998-2000)
5. **Political Emblem Toggle** - ⚑ button shows/hides emblems (lines 2001-2003)
6. **Sun Locked as Center** - Sun immovable at (0,0) (line 1552)
7. **Mercury Debris Field** - 600 particles in orbit (line 1124)

### ⚠️ Issues to Fix

#### 1. **SPACING NOT WORKING** (CRITICAL)
**Location**: Lines 183-189
```typescript
const DISTANCE_SCALE_A = 2.4  // Was increased from 1.6
const DISTANCE_SCALE_P = 1.35 // Was increased from 1.22
```
**Problem**: Despite increasing these values, planets still appear cramped
**User Feedback**: "spacing out didn't work"
**Possible Cause**: 
- Values may need to be even larger
- Check if seed function (lines 263-320) uses these values correctly
- Visual distance calculation in `visualFromLogicalRadius` may need adjustment

**Test**: After seeding, planets should be MUCH farther apart, especially outer planets.

#### 2. **SURFACE VIEW ZOOM NOT AUTOMATIC** (HIGH PRIORITY)
**Location**: Lines 2076-2079
```typescript
onViewSurface={null}  // Currently disabled
```
**Problem**: Removed surface view button, but automatic zoom transition not implemented
**User Feedback**: "zooming in does nothing to surface view"
**What's Needed**:
- When zoomed very close to a planet/moon (super-zoomed state line 1758), automatically transition to surface view
- Should check: `if (superZoomed && (focusedBody.kind === "planet" || focusedBody.kind === "moon"))`
- Trigger: `setSurfaceViewBodyId(focusedBody.id)` automatically
- Add smooth transition animation

**Goal**: User zooms close → automatic transition to surface map view

#### 3. **NO UI TO REPLACE DYSON SWARM MODEL** (MEDIUM PRIORITY)
**Location**: Lines 880-884
```typescript
{body.modelMediaId ? (
  <button onClick={() => onRemoveModel("high")}>Remove 3D model (.glb)</button>
) : (
  <button onClick={() => pickModel("high")}>
    {body.kind === "sun" ? "Set Dyson Swarm Model (.glb)" : "Set 3D Model (.glb)"}
  </button>
)}
```
**Problem**: Button text updated but user can't easily upload custom model
**User Feedback**: "i have no way to insert/replace the dyson swarm 3d model"
**Current Flow**:
1. User must click Sun to focus it
2. Enter edit mode
3. Click "Set Dyson Swarm Model (.glb)"
4. Upload via VVD media picker

**What's Needed**:
- Make it clearer in UI that you CAN upload models
- Add tooltip or help text
- Consider adding a dedicated "Manage Models" section
- Show current model preview if available

## 🎯 Priority Tasks for Qwen Coder

### Task 1: Fix Spacing (CRITICAL)
**File**: `src/app.tsx` lines 183-189, 263-320
**Goal**: Make planets MUCH farther apart
**Steps**:
1. Try increasing `DISTANCE_SCALE_A` to 4.0 or higher
2. Try increasing `DISTANCE_SCALE_P` to 1.5 or higher
3. Verify seed function uses `visualFromLogicalRadius` correctly
4. Test by running `vvd run`, seed system, zoom out fully
5. Outer planets should be VERY far from inner planets

**Verification**: After seeding, Neptune should be WAY out there, Earth should be much farther from Sun.

### Task 2: Implement Automatic Surface View Zoom
**File**: `src/app.tsx` lines 1755-1800 (tick function)
**Goal**: Auto-transition to surface view when super-zoomed on planet/moon
**Steps**:
1. In tick loop, after calculating `superZoomed` (line 1758)
2. Add check: If `superZoomed` and body is planet/moon
3. Call `setSurfaceViewBodyId(focusedBody.id)` 
4. Add debounce/threshold to prevent flickering
5. Store state ref to prevent repeated calls

**Example Code**:
```typescript
// Around line 1758-1760
const superZoomed = focusedBody != null && pose.distance < closeDistanceFor(focusedBody) * 1.4

// Add this new logic:
if (superZoomed && focusedBody && (focusedBody.kind === "planet" || focusedBody.kind === "moon")) {
  // Trigger surface view transition
  if (!surfaceViewTriggered) {
    setSurfaceViewBodyId(focusedBody.id)
    surfaceViewTriggered = true
  }
}
```

### Task 3: Improve Model Upload UX
**File**: `src/app.tsx` lines 880-884
**Goal**: Make it obvious users can upload custom models
**Steps**:
1. Add helper text above button: "Upload custom .glb model to replace default"
2. Add icon to button
3. Consider showing current model name if set
4. Add "Learn more" link to documentation

### Task 4: Verify VVD Maps Integration
**File**: `src/app.tsx` lines 595-704 (SurfaceView component)
**Goal**: Use VVD's built-in maps tool if available
**Check**: 
- See if VVD SDK has a maps capability: `useHostCapability("maps")`
- If available, replace current canvas-based surface view
- Consult `docs/` for VVD maps documentation

## 🔍 Code Navigation Tips

### Important Code Sections

**Solar System Rendering** (lines 1015-1500):
- Scene setup
- 3D object creation
- Dyson swarm building
- Planet/moon/asteroid rendering

**Animation Loop** (lines 1746-1900):
- Tick function
- Position updates
- Camera interpolation
- Label positioning

**UI Controls** (lines 1990-2100):
- Top bar controls
- Tier legend
- Layer toggles
- Edit mode buttons

**Data Model** (lines 104-123):
- `SolarBody` type definition
- All object properties

**Seed Function** (lines 263-320):
- Creates default solar system
- Sets up all planets/moons

## 🛠️ Development Workflow

1. **Make changes** in `src/app.tsx`
2. **Save file** - Hot reload happens automatically
3. **Test** in browser (VVD provides URL)
4. **Commit** changes: `git commit -m "Description"`
5. **Push** to GitHub: `git push`

## 🧪 Testing Checklist

After implementing fixes, test:

- [ ] **Spacing**: Seed system, zoom out, planets widely separated?
- [ ] **Surface Zoom**: Zoom close to Earth, auto-transition to surface?
- [ ] **Model Upload**: Click Sun, edit mode, button clear?
- [ ] **Touch**: Works on mobile? (use browser dev tools mobile emulation)
- [ ] **Pause**: Animation stops/resumes?
- [ ] **Tiers**: Click tier label, region highlights?
- [ ] **Emblems**: Toggle button works?

## 📚 VVD Principles (IMPORTANT!)

When making changes, follow VVD principles from `AGENTS.md`:

1. **Reference, don't retype**: Use document IDs, never duplicate data
2. **Collaboration default**: All state via codecs (document fields)
3. **Show presence**: Already implemented (facepile)
4. **Structure data properly**: Use `field.*` API correctly
5. **Canvases keep camera local**: Pan/zoom in React state (NOT in document)
6. **Secrets server-side**: N/A for this app

## 🐛 Debugging Tips

**White screen after changes?**
- Check browser console for errors
- Verify all event listeners cleaned up (lines 1903-1941)
- Hard refresh: Ctrl+Shift+R

**3D not rendering?**
- Three.js import may have failed
- Check console for "no three.js available" message
- Verify `npm install` completed successfully

**Changes not showing?**
- VVD hot-reload may need manual refresh
- Stop (`Ctrl+C`) and restart `vvd run`
- Clear browser cache

**Touch not working?**
- Check browser supports touch events
- Use Chrome DevTools mobile emulation
- Verify `passive: false` on touch listeners (lines 1732-1734)

## 📞 Support Resources

- **VVD Docs**: https://kilo.ai/docs
- **Three.js Docs**: https://threejs.org/docs/
- **Project Guides**: See `docs/` folder
- **Roadmap**: `roadmap.md` for feature status

## 🎓 Learning Resources

**VVD Concepts**:
- Read `AGENTS.md` first (core principles)
- Then `docs/references.md` (the big one!)
- Then `docs/collaboration-and-presence.md`

**Code Structure**:
- App uses React hooks extensively
- Three.js scene managed in useEffect
- VVD capabilities via `useHostCapability()`

## 💡 Quick Wins

Easy improvements to build momentum:

1. Add loading spinner while models load
2. Add tooltip on hover for controls
3. Improve error messages for failed model loads
4. Add keyboard shortcuts (Space = pause, R = recenter)
5. Add distance units display (AU, million km)

## ✨ Nice-to-Haves (Future)

- Multi-star system support
- Wormhole/jump gate visualization  
- Trade route overlays
- Fleet movement animation
- Time speed controls
- Realistic physics mode

## 📦 Dependencies

Already installed in `package.json`:
- VVD SDK (via VVD runtime)
- Three.js (dynamic import)
- React (provided by VVD)

No additional dependencies needed.

## 🚀 Ready to Code!

You now have everything needed to continue development. Start with **Task 1 (Fix Spacing)** as it's critical.

**First Command**:
```bash
vvd run
```

Then open the provided URL and click "⨁ Seed" in edit mode to see current state.

Good luck! 🎮

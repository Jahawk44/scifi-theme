# Ashes Beyond Light - VVD Solar System Map

A VVD wiki featuring an interactive 3D solar system map with realistic spacing, Dyson swarm visualization, and immersive navigation controls.

## 🌟 Features

### Core System
- **3D Solar System Map** - Interactive WebGL-based solar system with realistic orbital mechanics
- **Dense Dyson Swarm** - 660 satellites in 3 concentric rings around the sun with proper solar panel orientation
- **Realistic Spacing** - Large distances between planets inspired by NASA-Eyes and Antimatter game
- **Mercury Debris Field** - 600-particle debris cloud in Mercury's shattered orbital path
- **Tier System** - 4-tier political geography with region highlighting

### Controls
- **Desktop**: Drag to orbit, Right-drag/Shift-drag to pan, Scroll to zoom
- **Mobile/Touch**: Single finger to rotate, Two-finger pinch to zoom
- **Animation**: Pause/Resume button for orbital motion

### Visual Features
- **Political Emblems** - Toggle faction emblems with ⚑ button
- **Tier Highlights** - Click tier labels to highlight space regions with colored overlays
- **Location Pins** - Surface, orbital, and atmospheric colonies visible on zoom
- **Custom 3D Models** - Support for .glb model imports for planets and structures

### Technical
- **VVD Integration** - Built with VVD SDK following all core principles
- **Real-time Collaboration** - Native multiplayer support via VVD codecs
- **Presence System** - Shows active users and their cursors
- **Reference System** - Links to world documents instead of duplicating data
- **Touch-Optimized** - Full mobile and tablet support

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ and npm
- VVD CLI: `npm install -g vvd`

### Installation

\`\`\`bash
# Clone the repository
git clone <your-repo-url>
cd scifi-theme

# Install dependencies
npm install

# Start development server
vvd run
\`\`\`

### First Run

1. Open the VVD link in your browser (displayed in terminal)
2. Enter **Edit Mode**
3. Click the **"⨁ Seed"** button to populate the solar system
4. Exit edit mode to explore

## 📁 Project Structure

\`\`\`
scifi-theme/
├── src/
│   ├── app.tsx              # Main application and solar system renderer
│   ├── publish-hooks.ts     # Custom publishing hooks
│   └── theme.ts             # Theme configuration
├── docs/                    # VVD development guides
│   ├── references.md        # Reference system (start here!)
│   ├── collaboration-and-presence.md
│   ├── documents-and-data.md
│   ├── canvases.md
│   ├── server-endpoints-and-secrets.md
│   └── i18n.md
├── ABL 3D Models/          # 3D assets
│   ├── Dyson Swarm/
│   └── Mercury Remnants/
├── AGENTS.md               # AI agent instructions
├── roadmap.md              # Feature roadmap and status
└── vvd.json                # VVD manifest
\`\`\`

## 🎮 Controls Reference

### Mouse/Keyboard
| Action | Control |
|--------|---------|
| Rotate camera | Left click + drag |
| Pan view | Right click + drag OR Shift + drag |
| Zoom | Mouse wheel |
| Select object | Click |
| Pause/Resume | ⏸/▶ button |

### Touch
| Action | Control |
|--------|---------|
| Rotate camera | One finger drag |
| Zoom | Two finger pinch |
| Select object | Tap |

## 🔧 Configuration

### Distance Scaling
Adjust planetary spacing in \`src/app.tsx\`:
\`\`\`typescript
const DISTANCE_SCALE_A = 2.4  // Scale factor
const DISTANCE_SCALE_P = 1.35 // Power for exponential spread
\`\`\`

### Dyson Swarm
Configure satellite count and rings:
\`\`\`typescript
const rings = [
  { distance: b.size * 1.6, count: 180 },  // Inner ring
  { distance: b.size * 1.85, count: 220 }, // Middle ring
  { distance: b.size * 2.1, count: 260 },  // Outer ring
]
\`\`\`

### Tier Bands
Define political regions in \`TIER_BANDS\`:
\`\`\`typescript
const TIER_BANDS = [
  { id: "crown", label: "TIER I — SOLAR CROWN", radius: 110, color: "#e8eef8" },
  { id: "industrial", label: "TIER II — INDUSTRIAL CORE", radius: 250, color: "#5d8cff" },
  { id: "median", label: "TIER III — THE MEDIAN", radius: 390, color: "#c9a227" },
  { id: "frontier", label: "TIER IV — FAR FRONTIER", radius: 560, color: "#8b6fd6" },
]
\`\`\`

## 🎨 Customization

### Adding Custom 3D Models
1. Prepare a .glb file
2. In Edit Mode, select a body (e.g., Sun)
3. Click "Set Dyson Swarm Model (.glb)" or "Set 3D Model (.glb)"
4. Upload through VVD's media picker

### Creating Locations
1. In Edit Mode, click "+ Add Object"
2. Select "Location" type
3. Choose style: Surface, Orbital, or Atmospheric
4. Set parent body
5. Link to a world document for details

## 📚 VVD Principles

This app follows all VVD core principles:

1. **Reference, don't retype** - Uses document IDs and media references
2. **Collaboration default** - All state changes via codecs
3. **Show presence** - Facepile shows active users
4. **Structure data properly** - Uses field.* API correctly
5. **Canvases keep camera local** - Pan/zoom stays in React state
6. **Secrets server-side** - N/A for this app (no API endpoints)

See [AGENTS.md](AGENTS.md) for detailed development guidelines.

## 🗺️ Roadmap

See [roadmap.md](roadmap.md) for detailed feature tracking.

### Completed ✅
- Dense Dyson swarm with proper orientation
- Realistic planetary spacing
- Mercury debris field
- Touch controls for mobile
- Pause/resume animation
- Tier region highlighting
- Political emblem toggle
- Sun locked as center
- Clickable Dyson swarm with 3D viewer

### In Progress 🚧
- Surface view automatic zoom transition
- VVD maps integration for surface view
- Enhanced model replacement UI

### Planned 📋
- Multi-star system support
- Wormhole/jump gate visualization
- Trade route overlays
- Fleet movement paths
- Time controls (speed up/slow down)

## 🐛 Known Issues

1. **Spacing**: May need further refinement based on user feedback
2. **Surface View**: Currently uses button instead of automatic zoom transition
3. **Model Upload**: UI could be more intuitive for model replacement

## 🤝 Contributing

This project is designed to work with VVD's development workflow:

1. Make changes in \`src/\`
2. Hot-reload automatically updates the live tab
3. Use \`vvd save\` to save a new version
4. Use \`vvd publish\` to publish to Workshop

See VVD documentation for more details on the development workflow.

## 📄 License

This project is part of the VVD ecosystem. See VVD's terms for licensing details.

## 🔗 Links

- [VVD Documentation](https://kilo.ai/docs)
- [VVD World](https://beta.vvd.world)
- [Project Roadmap](roadmap.md)
- [Development Guide](AGENTS.md)

## 💡 Tips

- **Performance**: If the app lags, reduce Dyson swarm satellite count
- **Spacing**: Adjust DISTANCE_SCALE values to preference
- **Models**: Use low-poly models for better performance
- **Touch**: Works best on tablets, may need adjustments on small phones

## 🙏 Acknowledgments

- Built with VVD SDK
- Inspired by NASA Eyes and Antimatter game
- Three.js for 3D rendering
- Design follows VVD's reference-first philosophy

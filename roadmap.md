# scifi-theme Roadmap

This document tracks the implementation status of features and improvements for the VVD scifi-theme wiki solar system map.

**Last Updated:** 2026-08-31

## Reference Design
- **Antimatter Game** (https://store.steampowered.com/app/1343010/Antimatter/)
  - Surface zoom view capability
  - Large realistic spacing between space objects
  - Seamless planetary detail transitions

---

## ✅ Completed

### Bug Fixes
- [x] Fixed duplicate `open` variable declaration (line 1520 vs 1568)

---

## 🚧 In Progress

None currently

---

## 📋 High Priority (Core Functionality)

### Performance
- [ ] **Fix lag when displaying all full entries**
  - Issue: Super laggy when showing all full entries
  - Root cause analysis needed
  - Likely culprits: excessive re-renders, large DOM updates, missing memoization
  - Solution: Implement virtualization or pagination for entry lists

### Solar System Core Mechanics
- [ ] **Lock Sun as absolute center**
  - Sun should be immovable and always at (0, 0)
  - Disable drag/repositioning for sun body
  - Ensure all calculations reference sun as origin

- [ ] **Implement realistic spacing between space objects**
  - Reference: Antimatter game's vast spacing
  - Current power-law scaling may need adjustment
  - Consider logarithmic or exponential spacing for outer objects
  - Balance between realistic scale and usability

- [ ] **Implement continuous zoomed planet/moon view for tagged objects**
  - Smooth zoom transitions to planetary surface
  - Show detailed view when zoom level reaches threshold
  - Maintain context (show parent body relationship)
  - Support for tagged objects only (user-customizable)

---

## 🎨 Medium Priority (Features & UX)

### Mercury Debris Field
- [ ] **Convert Mercury to broken debris field**
  - Already has `shattered: true` flag in code (line 195)
  - Need enhanced visual representation
  - Distribute debris particles in Mercury's orbit
  - Keep 5 existing "Mercury Remnant" asteroids (lines 196)

### Political System
- [ ] **Add political layer with category toggle**
  - New UI control to show/hide political emblems
  - Store toggle state in user preferences (local, not synced)
  - Category system for grouping political affiliations
  - Respect VVD collaboration principles

- [ ] **Improve political emblem positioning**
  - Current issue: emblems blocked or blocking object bodies
  - Solution: Offset emblems outside body radius
  - Add leader lines connecting emblem to body
  - Ensure visibility at all zoom levels

### Animation Controls
- [ ] **Replace recenter button with pause/resume button**
  - Toggle orbit animation on/off
  - Store animation state locally (not in document per VVD canvases.md)
  - Update TIME_SCALE or freeze animation frame
  - Icon: pause/play instead of recenter

### Tier Visualization
- [ ] **Show colored highlight for selected tier**
  - When tier selected, highlight that region
  - Use semi-transparent overlay matching tier color
  - Tier bands already defined (lines 134-139)
  - Make it clear which space region belongs to which tier

### 3D Models & Visuals
- [ ] **Different 3D models for spaceships vs stations**
  - Currently both use same placeholder
  - Add distinct visual representation
  - Consider rotation/orientation for ships

- [ ] **Default abstract model for manually placed spaceships**
  - Simple geometric placeholder before admin uploads .glb
  - Exclude Dyson swarm (has its own model)
  - Icon or simple 3D primitive

- [ ] **Replace Dyson swarm with custom .glb model**
  - Two versions: HD for zoomed view, low-poly for system map
  - Solar panels pointed toward sun
  - Store in `modelMediaId` and `modelMediaIdLowPoly` fields (already in schema lines 75-76)
  - Performance: LOD switching based on zoom level

### Location Pins & Colonies
- [ ] **Add terrestrial colony pins (surface)**
  - Only visible on super-zoomed planet view
  - 2D pins on flat surface if possible
  - Linked to lore entries
  - Type: `kind: "location"`, `locationStyle: "surface"` (already in schema lines 74, 161)

- [ ] **Add orbital satellites**
  - Visible on zoomed view
  - Orbit parent body
  - Type: `kind: "location"`, `locationStyle: "orbital"`

- [ ] **Add atmospheric flying colonies**
  - Float in planet atmosphere layer
  - Visible on zoomed view
  - Type: `kind: "location"`, `locationStyle: "atmospheric"`

- [ ] **Location pins: Only show on super-zoomed view**
  - Hide at system overview level
  - Fade in smoothly as zoom increases
  - Threshold-based visibility

---

## 🔮 Low Priority (Polish & Advanced Features)

### Custom 3D Assets
- [ ] **.glb file import for planetary bodies**
  - Allow admins to upload custom planet models
  - Replace sphere with imported mesh
  - Use media picker (VVD media reference pattern)
  - Store in `modelMediaId` field

---

## 🏗️ Architecture Notes

### VVD Principles Compliance
All features must follow VVD core principles from AGENTS.md:

1. **References, not retyping**: Use document IDs and media IDs (already implemented via `linkedDocumentId`, `emblemMediaId`, `modelMediaId`)
2. **Collaboration default**: All state changes via codecs, proper field types
3. **Show presence**: Already implemented via facepile
4. **Structure data properly**: Using `field.*` API correctly
5. **Canvases keep camera local**: Pan/zoom stays in React state (already correct)
6. **Secrets server-side**: N/A for this app (no API endpoints)

### Performance Considerations
- Virtual scrolling for large entry lists
- Memoization of expensive calculations
- LOD (Level of Detail) for 3D models based on zoom
- Debounce zoom/pan updates
- Canvas optimization: only render visible objects

### Data Schema Extensions
Current `SolarBody` type already includes:
- `shattered?: boolean` (line 73)
- `locationStyle?: "surface" | "orbital" | "atmospheric"` (line 74)
- `modelMediaId?: string | null` (line 75)
- `modelMediaIdLowPoly?: string | null` (line 76)

These fields anticipate most requested features. Implementation needed in rendering logic.

---

## 📝 Notes

### Known Issues
1. Performance degrades with all entries visible - needs investigation
2. Political emblems can be obscured by bodies or vice versa

### Future Considerations
- Multi-star systems (currently single sun only)
- Wormholes or jump gates between distant points
- Trade routes visualization
- Fleet movement paths
- Time controls (speed up/slow down simulation)

---

## 🤝 Contributing

When implementing features:
1. Mark item as in progress in this roadmap
2. Follow VVD patterns from docs/ folder
3. Test with collaboration (multiple users)
4. Update this roadmap when complete
5. Consider performance impact (especially canvas rendering)

---

## Questions for User Confirmation

1. **Mercury debris**: Should the 5 existing remnant asteroids be kept, or replaced with a different visual effect?
2. **Political emblems**: Should they always be visible, or only at certain zoom levels?
3. **3D models**: What format constraints? File size limits?
4. **Realistic spacing**: How much visual distance between objects? (Current power law uses P=1.18)
5. **Performance**: How many entries are showing when it gets laggy? (helps diagnose the issue)

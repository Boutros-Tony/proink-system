/**
 * How the bottom of a unit, counter foot rails, and booth structures are built, from shop-fitting and venue sources:
 * Crown Display and SI Retail (plinths and kick plates), Madix gondolas, Furnica and UK toe-kick guides,
 * Make Bespoke and foot rail makers (bar counters), and the venue rules of the UK e-Guide, DWTC, and Messe Frankfurt.
 */

/** The plinth at the bottom of a shelving unit. Almost every unit has one, so it is always sent. */
export function plinthSection(): string {
  return `<plinths>
A plinth, also called a kick strip, kick plate, kicker, or foot front, closes the bottom front of a unit under its lowest shelf, so stock and dirt do not go underneath and the unit looks finished. It is its own element, never part of a side panel.
- Height: 100 to 150 mm on a built unit. A metal gondola uses a 100 mm kick plate under a 160 mm base, or 200 mm under a 260 mm base.
- Flush: on a display or POS unit the plinth sits between the two sides, under the bottom shelf, flush with the front. This is the default.
- Set back 50 to 75 mm for the toes on a counter or a unit people stand close to, such as a reception desk or a cashier.
- On a fixed unit it is screwed or glued between the sides. On levelling feet it clips onto the front feet so it can come off: item:hw-feet, four per unit plus two for each metre past the first, and item:hw-plinth-clips, two per plinth per metre. Feet suit a stand on an uneven hall floor.
- The plinth is MDF of the unit's board, on the cutting plan; its top edge is finished by the finishing rules.
When the sheet shows a strip at the bottom, use it. When a shelving unit has none drawn and the sheet does not show it open, ask with askUser: flush plinth 100 mm (recommended) / set-back plinth on levelling feet / open, no plinth.
</plinths>`;
}

/** The foot rail along a bar or high counter. Sent when the job has a counter. */
export function footRailSection(): string {
  return `<counters-and-foot-rails>
Counter heights: a bar counter 1000 to 1100 mm with a top overhang of 250 to 350 mm for stools; a reception or service counter 900 to 950 mm; an accessible section no higher than 850 mm.
A foot rail is a round tube along the bottom of a bar or high counter for people to rest a foot on.
- Tube: 50 mm diameter in stainless steel, brass, or black steel; 38 mm for a lighter rail. item:hw-foot-rail-tube by the meter of counter front.
- Position: the center of the tube 150 to 250 mm above the floor and 120 to 150 mm out from the counter front.
- Brackets: one within 150 mm of each end, then one at most every 1200 mm, and at least two on any side: item:hw-foot-rail-bracket. Each corner gets an elbow and each end an end cap: item:hw-foot-rail-fitting.
- The rail carries a person's weight, so the counter front behind each bracket needs solid blocking or a metal frame. Name it on the counter.
- It is bought in and fitted, not cut from board, so it is not an element.
When the sheet shows a tube near the floor along a counter, it is a foot rail. When a bar counter with stools has none drawn, ask with askUser: stainless 50 mm (recommended) / brass / black steel / no foot rail.
</counters-and-foot-rails>`;
}

/** Venue structure rules. Sent for booths, not for a shelf unit. */
export function standStructureSection(): string {
  return `<booth-structure>
Venues set their own rules and theirs always win; these are the usual limits from the UK e-Guide, Dubai World Trade Centre, and Messe Frankfurt. Warn in one line when a design reaches one, add the structure it needs to the cost, and never call a design approved.
- Build or a freestanding wall over 4000 mm high: a metal frame with base plates and structural calculations. The tallest a booth may go is the hall's clear height minus 500 mm unless the show allows more, and each show sets its own maximum.
- Platform: one step, at most 170 mm high, with supports at most 400 mm apart. Over 300 mm high it needs structural details and a ramp or steps.
- Double-deck booth: a structural engineer and a permit. The upper floor carries 5 kN/m², with handrails, stairs, a sign with the most people allowed, and sprinklers under a ceiling.
- Canopy: reinforced with metal and carried to the floor on legs of at least 76 mm tube.
- A logo or banner hung from a truss: a metal tube frame with bolted joints, and calculations.
- A modular shell-scheme booth is braced on all four sides at the top.
- Fabrics and drapes are fire-retardant to NFPA 701.
Steel for a frame, canopy, or deck is item:fab-steel by the kilogram, with its welding and painting in that price. When the venue matters and is not known, ask with askUser which venue it is.
</booth-structure>`;
}

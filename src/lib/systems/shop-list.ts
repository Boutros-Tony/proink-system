/**
 * The shop's own price list, from "Pro Ink List of Materials.xlsx" (November 2026), in English.
 * Prices are US dollars in cents. `row` is the spreadsheet row the price came from, so it can be checked.
 * Rows with no price, and the shop's tools (the "Asset" rows, cutters, drill bits), are left out.
 */

export type ShopBoard = {
  id: string;
  name: string;
  /** Pieces drawn in this material use this board. Null: picked by its id only. */
  piece: "mdf" | "wood" | "laminate" | null;
  priceCents: number;
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  row: number;
  /** The sheet did not give this, so it was assumed. */
  assumed?: string;
};

export type ShopItem = {
  id: string;
  name: string;
  group: "hardware" | "finishing" | "lighting" | "electrical" | "logistics" | "other";
  unit: string;
  priceCents: number;
  row: number;
  /** The Arabic or the unit on the sheet was unclear, so the name or unit is a best reading. */
  unsure?: string;
};

const STANDARD = { widthMm: 2440, heightMm: 1220 } as const;
const SIZE_ASSUMED = "size not on the sheet, taken as 1220 × 2440 mm";

function board(row: number, id: string, name: string, piece: ShopBoard["piece"], price: number, thicknessMm: number, size: { widthMm: number; heightMm: number } = STANDARD, assumed?: string): ShopBoard {
  return { id, name, piece, priceCents: Math.round(price * 100), ...size, thicknessMm, row, ...(assumed ? { assumed } : {}) };
}

function item(row: number, id: string, name: string, group: ShopItem["group"], unit: string, price: number, unsure?: string): ShopItem {
  return { id, name, group, unit, priceCents: Math.round(price * 100), row, ...(unsure ? { unsure } : {}) };
}

const BIG = { widthMm: 3660, heightMm: 1830 } as const;
const WIDE = { widthMm: 2800, heightMm: 2200 } as const;

export const SHOP_BOARDS: ShopBoard[] = [
  // Acrylic (plexi)
  board(63, "acrylic-clear-2", "Acrylic clear 2 mm", null, 30, 2),
  board(64, "acrylic-clear-2-5", "Acrylic clear 2.5 mm", null, 31, 2.5),
  board(65, "acrylic-clear-4", "Acrylic clear 4 mm", null, 61, 4),
  board(66, "acrylic-clear-6", "Acrylic clear 6 mm", null, 91.2, 6),
  board(67, "acrylic-clear-8", "Acrylic clear 8 mm", null, 122, 8),
  board(68, "acrylic-clear-10", "Acrylic clear 10 mm", null, 145, 10, STANDARD, SIZE_ASSUMED),
  board(71, "acrylic-white-2", "Acrylic white 2 mm", null, 32, 2, STANDARD, SIZE_ASSUMED),
  board(72, "acrylic-white-4", "Acrylic white 4 mm", null, 64, 4, STANDARD, SIZE_ASSUMED),
  board(73, "acrylic-white-5", "Acrylic white 5 mm", null, 83, 5, STANDARD, SIZE_ASSUMED),
  board(74, "acrylic-black-2", "Acrylic black 2 mm", null, 32, 2, STANDARD, SIZE_ASSUMED),
  board(75, "acrylic-black-2-5", "Acrylic black 2.5 mm", null, 36, 2.5, STANDARD, SIZE_ASSUMED),
  board(76, "acrylic-black-4", "Acrylic black 4 mm", null, 66, 4, STANDARD, SIZE_ASSUMED),
  board(77, "acrylic-opal-2", "Acrylic opal (milky) 2 mm", null, 32, 2, STANDARD, SIZE_ASSUMED),
  board(78, "acrylic-opal-4", "Acrylic opal (milky) 4 mm", null, 57, 4, STANDARD, SIZE_ASSUMED),
  board(79, "acrylic-opal-6", "Acrylic opal (milky) 6 mm", null, 96, 6, STANDARD, SIZE_ASSUMED),
  board(80, "acrylic-opal-8", "Acrylic opal (milky) 8 mm", null, 125, 8, STANDARD, SIZE_ASSUMED),
  board(83, "acrylic-yellow-215-2-5", "Acrylic yellow #215 2.5 mm", null, 40, 2.5),
  board(84, "acrylic-red-2", "Acrylic red 2 mm", null, 29, 2, STANDARD, SIZE_ASSUMED),
  board(87, "acrylic-gold-2", "Acrylic gold 2 mm", null, 42, 2, STANDARD, SIZE_ASSUMED),
  board(88, "acrylic-silver-mirror-2", "Acrylic silver mirror 2 mm", null, 42, 2, STANDARD, SIZE_ASSUMED),
  board(91, "acrylic-red-135-2-5", "Acrylic red #135 2.5 mm", null, 41, 2.5),
  board(92, "acrylic-orange-128-2-5", "Acrylic orange #128 2.5 mm", null, 36, 2.5),
  board(93, "acrylic-green-348-2-5", "Acrylic green #348 2.5 mm", null, 41, 2.5),
  board(94, "polycarbonate-0-5", "Polycarbonate sheet 0.5 mm", null, 14, 0.5, { widthMm: 1830, heightMm: 1220 }),
  // Foam board and PVC
  board(89, "foam-board-5", "Foam board 5 mm", null, 9, 5),
  board(90, "foam-board-10", "Foam board 10 mm", null, 14, 10),
  board(95, "pvc-1", "PVC sheet 1 mm", null, 5.5, 1, STANDARD, SIZE_ASSUMED),
  board(96, "pvc-2", "PVC sheet 2 mm", null, 6, 2),
  board(97, "pvc-3", "PVC sheet 3 mm", null, 9, 3),
  board(98, "pvc-5", "PVC sheet 5 mm", null, 12.5, 5),
  board(99, "pvc-8", "PVC sheet 8 mm", null, 20, 8, STANDARD, SIZE_ASSUMED),
  board(100, "pvc-10", "PVC sheet 10 mm", null, 22, 10, STANDARD, SIZE_ASSUMED),
  board(101, "pvc-black-3", "PVC sheet black 3 mm", null, 13, 3, STANDARD, SIZE_ASSUMED),
  // Melamine-faced board ("Lamica")
  board(185, "melamine-white-18", "Melamine board white 18 mm", "laminate", 52, 18, BIG, "size and thickness not on the sheet, taken as 1830 × 3660 × 18 mm"),
  board(186, "melamine-colored-18", "Melamine board colored 18 mm", null, 57, 18, BIG, "size and thickness not on the sheet, taken as 1830 × 3660 × 18 mm"),
  board(187, "melamine-white-mr-18", "Melamine board white, moisture-resistant 18 mm", null, 62, 18, BIG, "size and thickness not on the sheet, taken as 1830 × 3660 × 18 mm"),
  board(188, "melamine-colored-mr-18", "Melamine board colored, moisture-resistant 18 mm", null, 69, 18, BIG, "size and thickness not on the sheet, taken as 1830 × 3660 × 18 mm"),
  // MDF. The sheet writes 1.7 mm for the 17 mm board.
  board(189, "mdf-17-3660x1830", "MDF 17 mm, 3660 × 1830", "mdf", 40, 17, BIG),
  board(190, "mdf-17-2440x1220", "MDF 17 mm, 2440 × 1220", "mdf", 16.08, 17),
  board(192, "mdf-17-2800x2200", "MDF 17 mm, 2800 × 2200", "mdf", 39.4, 17, WIDE),
  board(207, "mdf-30-3660x1830", "MDF 30 mm, large", "mdf", 83.5, 30, BIG, "sheet says big, taken as 1830 × 3660 mm"),
  board(208, "mdf-30-2440x1220", "MDF 30 mm, small", "mdf", 35.5, 30, STANDARD, "sheet says small, taken as 1220 × 2440 mm"),
  board(201, "mdf-12-3600x1800", "MDF 12 mm, 3600 × 1800", "mdf", 28, 12, { widthMm: 3600, heightMm: 1800 }, "sheet gives only 360x180x12, taken as MDF"),
  board(193, "mdf-10-3660x1830", "MDF 10 mm, 3660 × 1830", "mdf", 26, 10, BIG),
  board(194, "mdf-10-2440x1220", "MDF 10 mm, 2440 × 1220", "mdf", 9.23, 10),
  board(195, "mdf-10-2800x2200", "MDF 10 mm, 2800 × 2200", "mdf", 23.87, 10, WIDE),
  board(196, "mdf-8-3600x1800", "MDF 8 mm, 3600 × 1800", "mdf", 20.25, 8, { widthMm: 3600, heightMm: 1800 }, "sheet gives only 360x180x8, taken as MDF"),
  board(197, "mdf-8-2400x1200", "MDF 8 mm, 2400 × 1200", "mdf", 7.5, 8, { widthMm: 2400, heightMm: 1200 }, "sheet gives only 240x120x8, taken as MDF"),
  board(198, "mdf-6-2800x2200", "MDF 6 mm, 2800 × 2200", "mdf", 14.25, 6, WIDE),
  board(199, "mdf-6-2440x1220", "MDF 6 mm, 2440 × 1220", "mdf", 6, 6),
  board(200, "mdf-3-2440x1220", "MDF 3 mm, 2440 × 1220", "mdf", 3.27, 3),
  board(206, "hardboard-white-6", "White-faced hardboard (Masonite) 6 mm", null, 8.51, 6),
  // Plywood
  board(202, "plywood-18", "Plywood 18 mm (Indonesian)", "wood", 56.28, 18),
  board(203, "plywood-9", "Plywood 9 mm", "wood", 36.18, 9),
  board(204, "plywood-6", "Plywood 6 mm", "wood", 26.1, 6),
  board(205, "plywood-5", "Plywood 5 mm (Indonesian)", "wood", 10.73, 5),
];

export const SHOP_ITEMS: ShopItem[] = [
  // Hooks
  item(137, "hook-metal-10", "Metal hook 10 cm, with 2 wall screws", "hardware", "each", 0.32),
  item(138, "hook-metal-15", "Metal hook 15 cm, screw-fixed", "hardware", "each", 0.3),
  item(139, "hook-double-20", "Double hook 20 cm", "hardware", "each", 0.7),
  item(140, "hook-double-25", "Double hook 25 cm", "hardware", "each", 0.7),
  item(141, "hook-double-30-tag", "Double hook 30 cm with price tag", "hardware", "each", 0.75),
  item(142, "hook-double-15-tag-perforated", "Double hook 15 cm with price tag, for a perforated back", "hardware", "each", 0.77),
  item(143, "hook-single-15-perforated", "Single hook 15 cm, for a perforated back", "hardware", "each", 0.28),
  item(146, "hook-single-20-perforated", "Single hook 20 cm, no price tag, for a perforated back", "hardware", "each", 0.3),
  item(145, "hook-single-30", "Single hook 30 cm, no price tag", "hardware", "each", 0.31),
  item(147, "hook-single-30-tag-board", "Single hook 30 cm with price tag, fixed on a wood panel", "hardware", "each", 0.82),
  item(148, "hw-data-strip", "Shelf price strip, plastic, 130 cm, self-adhesive", "hardware", "each", 3),
  // Screws, nails, brackets
  item(16, "screw-black-70", "Black screws 70 mm", "hardware", "box", 4),
  item(17, "screw-black-50", "Black screws 50 mm", "hardware", "box", 2.7),
  item(19, "screw-black-30", "Black screws 30 mm", "hardware", "box", 4),
  item(20, "screw-black-20", "Black screws 20 mm", "hardware", "box", 3.6),
  item(21, "screw-black-15", "Black screws 15 mm", "hardware", "box", 3.6),
  item(22, "screw-yellow-70", "Yellow screws 70 mm", "hardware", "box", 5),
  item(28, "bracket-plastic-30", "Corner bracket, white plastic 30 × 30 mm", "hardware", "each", 0.05),
  item(29, "bracket-metal-30", "Corner bracket, metal 30 × 30 mm", "hardware", "each", 0.07),
  item(30, "bracket-metal-50", "Corner bracket, metal 50 × 50 mm", "hardware", "each", 0.12),
  item(31, "nail-brad-12", "Brad nails for the air gun 12 mm", "hardware", "box", 4.82),
  item(33, "nail-brad-20", "Brad nails for the air gun 20 mm", "hardware", "box", 2.5),
  item(32, "nail-brad-30", "Brad nails for the air gun 30 mm", "hardware", "box", 2.5),
  item(35, "nail-brad-40", "Brad nails for the air gun 40 mm", "hardware", "box", 4),
  item(34, "nail-brad-50", "Brad nails for the air gun 50 mm", "hardware", "box", 2.7),
  item(36, "nail-pin-12", "Pin nails 12 mm", "hardware", "box", 7),
  item(39, "nail-kaab-1000", "Nails (kaab), box of 1000", "hardware", "box", 30, "the sheet says Mismar Kaab; the nail type is not clear"),
  item(40, "hinge-dtc-soft-close", "DTC soft-close hinge: full overlay, half overlay, or inset", "hardware", "each", 0.99),
  item(161, "push-latch-chinese", "Push-to-open latch, Chinese", "hardware", "each", 0.8),
  item(162, "push-latch-italian", "Push-to-open latch, Italian", "hardware", "each", 3),
  item(179, "drawer-lock", "Drawer lock, long or short neck", "hardware", "each", 3.4),
  item(178, "fastener-butterfly-clear", "Clear butterfly fasteners", "hardware", "each", 0.09, "the Arabic is not clear"),
  // Drawer slides
  item(42, "slide-250", "Telescopic drawer slide, soft-close, 25 cm", "hardware", "each", 3.75),
  item(43, "slide-300", "Telescopic drawer slide, soft-close, 30 cm", "hardware", "each", 4),
  item(44, "slide-350", "Telescopic drawer slide, soft-close, 35 cm", "hardware", "each", 4.87),
  item(45, "slide-400", "Telescopic drawer slide, soft-close, 40 cm", "hardware", "each", 4.5),
  item(46, "slide-450", "Telescopic drawer slide, soft-close, 45 cm", "hardware", "each", 5.63),
  item(47, "slide-500", "Telescopic drawer slide, soft-close, 50 cm", "hardware", "each", 6.44),
  item(48, "slide-550", "Telescopic drawer slide, soft-close, 55 cm", "hardware", "each", 6.8),
  item(49, "slide-600", "Telescopic drawer slide, soft-close, 60 cm", "hardware", "each", 7.39),
  // Tape
  item(6, "tape-double-white-5", "Double-sided tape, white, 5 mm", "finishing", "roll", 11),
  item(7, "tape-double-white-10", "Double-sided tape, white, 10 mm", "finishing", "roll", 7.5),
  item(8, "tape-double-white-15", "Double-sided tape, white, 15 mm", "finishing", "roll", 9),
  item(9, "tape-double-white-20", "Double-sided tape, white, 20 mm", "finishing", "roll", 11.25),
  item(10, "tape-double-white-30", "Double-sided tape, white, 30 mm", "finishing", "roll", 18),
  item(11, "tape-double-white-38", "Double-sided tape, white, 38 mm", "finishing", "roll", 22.5),
  item(12, "tape-double-white-50", "Double-sided tape, white, 50 mm", "finishing", "roll", 30),
  item(14, "tape-double-clear-12", "Double-sided tape, clear, 12 mm", "finishing", "roll", 13.32),
  item(15, "tape-double-clear-20", "Double-sided tape, clear, 20 mm", "finishing", "roll", 19.98),
  item(13, "tape-double-clear-50", "Double-sided tape, clear, 50 mm", "finishing", "roll", 53.28),
  item(52, "tape-masking-15", "Masking tape 15 mm", "finishing", "roll", 0.42),
  item(53, "tape-masking-50", "Masking tape 50 mm", "finishing", "roll", 1.25),
  item(54, "tape-masking-wide", "Masking tape, wide", "finishing", "roll", 0.88),
  // Glue and silicone
  item(50, "glue-acrylic", "Acrylic glue", "finishing", "bottle", 15),
  item(51, "glue-super-activator", "Super glue with activator spray (AK Fix)", "finishing", "each", 3.15),
  item(56, "silicone-clear-acetic", "Silicone, clear, acetic (Den Braven)", "finishing", "tube", 4),
  item(57, "silicone-clear-neutral", "Silicone, clear, neutral, 310 ml (Den Braven)", "finishing", "tube", 4.25),
  item(58, "silicone-white-high-tack", "High-tack adhesive, white", "finishing", "tube", 7),
  item(60, "glue-wood-dispertec-30", "Wood glue Dispertec, 30 kg", "finishing", "drum", 90),
  item(61, "glue-wood-facol-50", "Wood glue Facol, 50 kg", "finishing", "drum", 99),
  item(62, "glue-facol-yellow-4", "Facol yellow glue, 4 kg", "finishing", "can", 13.5),
  // Paint
  item(102, "paint-pu-primer-black", "PU primer, black (Asco)", "finishing", "barrel", 140),
  item(103, "paint-pu-primer-white-asco", "PU primer, white (Asco)", "finishing", "barrel", 133.5),
  item(104, "paint-pu-primer-white-flora", "PU primer, white (Flora)", "finishing", "barrel", 105),
  item(105, "paint-pu-black-30", "PU paint, black, 30% gloss (Asco)", "finishing", "gallon", 35),
  item(106, "paint-pu-white-30", "PU paint, white, 30% gloss", "finishing", "gallon", 35),
  item(107, "paint-pu-white-10", "PU paint, white, 10% gloss (Asco)", "finishing", "gallon", 43.25),
  item(108, "paint-pu-black-10", "PU paint, black, 10% gloss (Asco)", "finishing", "gallon", 36),
  item(111, "paint-pu-primer", "Polyurethane primer", "finishing", "gallon", 135, "the sheet says gallon, but the price is close to a barrel of primer"),
  item(164, "paint-spray-black-matt", "Spray paint, black matt (Asmaco)", "finishing", "can", 1.35),
  item(109, "putty-metal-2kg", "Metal body filler, 2 kg", "finishing", "can", 4.5),
  item(110, "putty-fiber-2kg", "Fiber filler, 2 kg", "finishing", "can", 8),
  item(130, "thinner-barrel", "Thinner", "finishing", "barrel", 310),
  item(131, "filler-stick", "Filler stick", "finishing", "each", 1.5, "the Arabic is not clear"),
  // Sanding and protection
  item(112, "sandpaper-100", "Sandpaper, grit 100", "finishing", "box", 15),
  item(113, "sandpaper-120", "Sandpaper, grit 120", "finishing", "box", 15),
  item(114, "sandpaper-150", "Sandpaper, grit 150", "finishing", "box", 15),
  item(116, "sandpaper-220", "Sandpaper, grit 220", "finishing", "box", 14),
  item(117, "sandpaper-320", "Sandpaper, grit 320", "finishing", "box", 14),
  item(118, "sandpaper-400", "Sandpaper, grit 400", "finishing", "box", 15),
  item(126, "sanding-disc-100-large", "Grinder sanding discs, grit 100, large", "finishing", "box", 27),
  item(127, "sanding-disc-100-small", "Grinder sanding discs, grit 100, small", "finishing", "box", 15),
  item(124, "sanding-disc-120-large", "Grinder sanding discs, grit 120, large", "finishing", "box", 27),
  item(125, "sanding-disc-120-small", "Grinder sanding discs, grit 120, small", "finishing", "box", 15),
  item(128, "masks-box", "Dust masks", "finishing", "box", 14),
  item(163, "respirator-filter", "Respirator with filter, for painting", "finishing", "each", 18),
  item(129, "gloves-box", "Gloves", "finishing", "box", 10),
  item(172, "wiping-rags", "Wiping rags", "finishing", "kg", 3),
  item(133, "easy-gallon", "Easy", "other", "gallon", 2.45, "the sheet only says Easy; what the product is, is not clear"),
  // Packing
  item(136, "stretch-film", "Stretch film for packing, 50 cm, 2.5 kg", "logistics", "roll", 5.4),
  item(169, "bubble-wrap", "Bubble wrap", "logistics", "roll", 9.91),
  // Lighting
  item(218, "led-strip-8mm-5m", "LED strip 8 mm, 5 m", "lighting", "roll", 5),
  item(219, "led-strip-5mm-10m", "LED strip 5 mm, 10 m", "lighting", "roll", 15),
  item(233, "led-neon-8mm", "LED neon flex 8 mm: white, warm, blue, green, or red", "lighting", "each", 7, "the sheet says a 50 m roll, but the price looks like less than a roll"),
  item(234, "led-neon-6mm", "LED neon flex 6 mm: white, warm, blue, green, or red", "lighting", "each", 6, "the sheet says a 50 m roll, but the price looks like less than a roll"),
  item(229, "tube-t5-90", "T5 light tube 90 cm, 3000 K", "lighting", "each", 3),
  item(230, "tube-t5-30", "T5 light tube 30 cm, 9 W", "lighting", "each", 2.3),
  item(221, "led-profile-12x7-1m", "LED aluminium profile 12.5 × 7.5 mm, 1 m", "lighting", "each", 1.75),
  item(222, "led-profile-17x7-1m", "LED aluminium profile 17 × 7.5 mm, 1 m", "lighting", "each", 1.75),
  item(209, "alu-profile-7x17-3m", "Aluminium profile 7 × 17 mm, silver, 3 m", "lighting", "each", 3.5),
  item(210, "alu-profile-15x6", "Aluminium profile 15 × 6 mm", "lighting", "each", 4.5),
  item(211, "alu-profile-30x10-3m", "Aluminium profile 30 × 10 mm, silver, 3 m", "lighting", "each", 9),
  item(227, "led-profile-surface", "LED profile, surface-mounted", "lighting", "each", 3.5, "the sheet says Profile tabech"),
  item(228, "led-profile-recessed", "LED profile, recessed", "lighting", "each", 3.5, "the sheet says Profile farez"),
  // Electrical
  item(212, "led-driver-60", "LED power supply 60 W", "electrical", "each", 6),
  item(213, "led-driver-100", "LED power supply 100 W", "electrical", "each", 8),
  item(214, "led-driver-150", "LED power supply 150 W", "electrical", "each", 8),
  item(215, "led-driver-200", "LED power supply 200 W", "electrical", "each", 10),
  item(216, "led-driver-300", "LED power supply 300 W", "electrical", "each", 12),
  item(217, "led-driver-400", "LED power supply 400 W", "electrical", "each", 12),
  item(231, "dimmer-12v", "Dimmer 12 V", "electrical", "each", 9),
  item(220, "cable-bell-2x0-5", "Bell wire 2 × 0.5 mm (Liban Cables)", "electrical", "roll", 13),
  item(223, "cable-2x1-5-flat-colored", "Cable 2 × 1.5 mm, flat, colored, 100 m", "electrical", "roll", 58),
  item(224, "cable-2x1-5-white", "Cable 2 × 1.5 mm, white, 100 m", "electrical", "roll", 72.55),
  item(225, "cable-2x1-5-black-red", "Cable 2 × 1.5 mm, black and red, 100 m", "electrical", "roll", 76.85),
  item(226, "cable-2x1-5-round-black", "Cable 2 × 1.5 mm, round, black", "electrical", "roll", 94.5),
];

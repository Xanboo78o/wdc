// bridgebtn.js — rim buttons that arrive from tools/ffb.py instead of Chrome.
//
// Chrome hands a page only the first 32 of a gamepad's buttons; Adam's R3
// declares 128, and MENU (37) and confirm (35) are past the cut. The bridge
// reads the wheel directly and sends each press; js/ffb.js fills this set and
// js/input.js treats a button in it as pressed. Numbers are joydev numbers,
// the same ones pad.html and data/wheelbtn.json use.
export const bridgeButtons = new Set();

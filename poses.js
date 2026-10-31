// Target figures are normalized (0..1) in a 3:4 frame. Keys: h head, n neck, ls rs shoulders, le re elbows, lw rw wrists, lh rh hips, lk rk knees, la ra ankles.
// "l" is the left side of the image.
const base = {h:[.5,.16],n:[.5,.25],ls:[.42,.27],rs:[.58,.27],le:[.39,.4],re:[.61,.4],lw:[.38,.52],rw:[.62,.52],lh:[.45,.53],rh:[.55,.53],lk:[.45,.7],rk:[.55,.7],la:[.45,.88],ra:[.55,.88]};
const fig = (o = {}, dx = 0, s = 1, dy = 0) => {
  const f = {...base, ...o}; const r = {};
  for (const k in f) r[k] = [.5 + (f[k][0] - .5) * s + dx, .5 + (f[k][1] - .5) * s + dy];
  return r;
};
// Landmark helpers (MediaPipe indices)
const I = {nose:0, le:2, re:5, lsh:11, rsh:12, lel:13, rel:14, lwr:15, rwr:16, lhip:23, rhip:24, lkn:25, rkn:26, lan:27, ran:28};
const P = (p, k) => p[I[k]];
const vis = (p, ks) => ks.every(k => (P(p,k).visibility ?? 1) > .5 && P(p,k).x > -.02 && P(p,k).x < 1.02 && P(p,k).y > -.02 && P(p,k).y < 1.02);
const dist = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) * 4/3);
const angle = (a, b, c) => { const v1=[a.x-b.x,(a.y-b.y)*4/3], v2=[c.x-b.x,(c.y-b.y)*4/3]; const d=(v1[0]*v2[0]+v1[1]*v2[1])/(Math.hypot(...v1)*Math.hypot(...v2)||1); return Math.acos(Math.max(-1,Math.min(1,d)))*180/Math.PI; };
const tilt = (a, b) => Math.atan2((b.y - a.y)*4/3, b.x - a.x) * 180 / Math.PI;
const mid = (a, b) => ({x:(a.x+b.x)/2, y:(a.y+b.y)/2});
const shW = p => dist(P(p,'lsh'), P(p,'rsh'));
const torso = p => dist(mid(P(p,'lsh'),P(p,'rsh')), mid(P(p,'lhip'),P(p,'rhip')));
const band = (v, lo, hi, soft) => v >= lo && v <= hi ? 1 : Math.max(0, 1 - Math.min(Math.abs(v-lo), Math.abs(v-hi)) / soft);
const C = (text, fn, measured = true) => ({text, fn, measured});
const first = ps => ps[0];

// Reusable checks
const inFrame = (ks, msg) => C(msg, ps => ps.length && vis(first(ps), ks) ? 1 : 0);
const shoulderTurn = C('Turn your shoulders about 45 degrees away from the camera', ps => { const p = first(ps); if (!vis(p,['lsh','rsh','lhip','rhip'])) return 0; return band(shW(p)/torso(p), .35, .62, .35); });
const shoulderTurnBust = C('Turn your shoulders slightly away from the camera', ps => { const p = first(ps); const r = shW(p) / dist(P(p,'le'), P(p,'re')); return band(r, 2.2, 4.2, 1.5); });
const headTilt = C('Tilt your head slightly toward one shoulder', ps => { const p = first(ps); const t = Math.abs(tilt(P(p,'le'), P(p,'re'))); const a = Math.min(t, 180 - t); return band(a, 4, 16, 6); });
const levelEyes = C('Keep your eyes level, head straight', ps => { const p = first(ps); const t = Math.abs(tilt(P(p,'le'), P(p,'re'))); const a = Math.min(t, 180 - t); return band(a, 0, 6, 6); });
const chinDown = C('Chin slightly down and forward', ps => { const p = first(ps); const eyeY = (P(p,'le').y + P(p,'re').y)/2; const shY = (P(p,'lsh').y + P(p,'rsh').y)/2; const r = (shY - P(p,'nose').y) / Math.max(.01, shY - eyeY); return band(r, .55, .82, .25); });
const relaxShoulders = C('Relax and drop your shoulders', ps => { const p = first(ps); const t = Math.abs(tilt(P(p,'lsh'), P(p,'rsh'))); const a = Math.min(t, 180 - t); return band(a, 0, 10, 8); });
const weightBack = C('Put your weight on your back leg', ps => { const p = first(ps); const h = mid(P(p,'lhip'),P(p,'rhip')); const a = mid(P(p,'lan'),P(p,'ran')); const w = Math.abs(P(p,'lan').x - P(p,'ran').x) || .01; return band(Math.abs(h.x - a.x) / w, .12, 2, .12); });
const softKnee = C('Bend your front knee a little', ps => { const p = first(ps); const k = Math.min(angle(P(p,'lhip'),P(p,'lkn'),P(p,'lan')), angle(P(p,'rhip'),P(p,'rkn'),P(p,'ran'))); return band(k, 130, 172, 15); });
const armsAway = C('Let your arms hang a little away from your body', ps => { const p = first(ps); const gl = Math.abs(P(p,'lwr').x - P(p,'lhip').x), gr = Math.abs(P(p,'rwr').x - P(p,'rhip').x); return band(Math.max(gl, gr) / shW(p), .25, 3, .2); });
const handOnHip = C('Put one hand on your hip', ps => { const p = first(ps); const best = Math.max(...[['lsh','lel','lwr','lhip'],['rsh','rel','rwr','rhip']].map(([s,e,w,h]) => band(angle(P(p,s),P(p,e),P(p,w)), 50, 115, 30) * band(dist(P(p,w),P(p,h))/shW(p), 0, .55, .4))); return best; });
const centered = C('Move to the center of the frame', ps => { const p = first(ps); const m = mid(P(p,'lsh'),P(p,'rsh')); return band(m.x, .35, .65, .15); });

export const POSES = [
  {id:'portrait', name:'Portrait', blurb:'Head and shoulders, flattering angle', icon:'M32 10a8 8 0 1 1 0 16a8 8 0 1 1 0-16M16 54c2-12 9-18 16-18s14 6 16 18',
   steps:[shoulderTurnBust, chinDown, headTilt, relaxShoulders], need:['nose','le','re','lsh','rsh'], frame:'Show your head and shoulders',
   tips:['Relax your jaw and breathe out before the shot','Look just above the lens for a softer look'],
   target: fig({h:[.5,.3],n:[.5,.48],ls:[.32,.56],rs:[.64,.52],le:[.26,.85],re:[.7,.82],lw:[.26,1.1],rw:[.7,1.1],lh:[.4,1.2],rh:[.6,1.2],lk:[.4,1.3],rk:[.6,1.3],la:[.4,1.4],ra:[.6,1.4]},0,1),
   start: fig({h:[.5,.3],n:[.5,.48],ls:[.28,.55],rs:[.72,.55],le:[.24,.85],re:[.76,.85],lw:[.24,1.1],rw:[.76,1.1],lh:[.4,1.2],rh:[.6,1.2],lk:[.4,1.3],rk:[.6,1.3],la:[.4,1.4],ra:[.6,1.4]}), crop:'bust'},
  {id:'fullbody', name:'Full body', blurb:'Head to toe, relaxed and tall', icon:'M32 6a6 6 0 1 1 0 12a6 6 0 1 1 0-12M32 20v20M20 28l12-4l12 4M32 40l-8 18M32 40l8 18',
   steps:[shoulderTurn, weightBack, softKnee, armsAway, chinDown], need:['nose','lsh','rsh','lhip','rhip','lkn','rkn','lan','ran'], frame:'Step back until your whole body, head to feet, is in frame',
   tips:['Stand tall, lengthen your neck','Camera at waist height makes legs look longer'],
   target: fig({ls:[.45,.27],rs:[.56,.28],le:[.41,.4],re:[.61,.41],lw:[.38,.52],rw:[.6,.52],lh:[.46,.53],rh:[.54,.53],lk:[.49,.7],rk:[.53,.7],la:[.46,.88],ra:[.58,.87]}), start: fig()},
  {id:'couple', name:'Couple', blurb:'Two people, close and connected', icon:'M22 12a6 6 0 1 1 0 12a6 6 0 1 1 0-12M42 12a6 6 0 1 1 0 12a6 6 0 1 1 0-12M12 54c1-14 6-24 10-24s9 10 10 24M32 54c1-14 6-24 10-24s9 10 10 24', people:2,
   steps:[C('Both of you step into the frame', ps => ps.length >= 2 ? 1 : 0), C('Move closer together', ps => { if (ps.length < 2) return 0; const d = dist(P(ps[0],'nose'), P(ps[1],'nose')); return band(d / ((shW(ps[0])+shW(ps[1]))/2), 0, 1.3, .8); }),
     C('Turn slightly toward each other', ps => ps.length < 2 ? 0 : (band(shW(ps[0])/torso(ps[0]),.3,.7,.3) + band(shW(ps[1])/torso(ps[1]),.3,.7,.3)) / 2),
     C('Bring your heads to slightly different heights', ps => { if (ps.length < 2) return 0; const dy = Math.abs(P(ps[0],'nose').y - P(ps[1],'nose').y); return band(dy / shW(ps[0]), .1, 1.2, .1); })],
   need:['nose','lsh','rsh'], frame:'Fit both of you in the frame, at least from the waist up',
   tips:['Lean your heads in a little','Hold hands or put an arm around the waist'],
   target: {multi:[fig({h:[.5,.17],ls:[.43,.28],rs:[.56,.27]},-.13,.9), fig({ls:[.45,.24],rs:[.57,.25],h:[.5,.13]},.12,.95,-.03)]}, start:{multi:[fig({},-.22,.9), fig({},.22,.9)]}},
  {id:'group', name:'Group', blurb:'Three or more, everyone visible', icon:'M14 18a5 5 0 1 1 0 10a5 5 0 1 1 0-10M32 12a6 6 0 1 1 0 12a6 6 0 1 1 0-12M50 18a5 5 0 1 1 0 10a5 5 0 1 1 0-10M6 54c1-12 4-20 8-20s7 8 8 20M22 54c1-14 5-24 10-24s9 10 10 24M42 54c1-12 4-20 8-20s7 8 8 20', people:5,
   steps:[C('Everyone step into the frame (at least 3 people)', ps => Math.min(1, ps.length / 3)), C('Make sure every face is visible to the camera', ps => ps.length >= 3 && ps.every(p => vis(p,['nose','le','re'])) ? 1 : 0),
     C('Stand closer together, no big gaps', ps => { if (ps.length < 3) return 0; const xs = ps.map(p => P(p,'nose').x).sort((a,b)=>a-b); let g = 0; for (let i=1;i<xs.length;i++) g = Math.max(g, xs[i]-xs[i-1]); const w = ps.reduce((s,p)=>s+shW(p),0)/ps.length; return band(g / w, 0, 1.4, .8); }),
     C('Taller people to the back or sides, mix up head heights', ps => { if (ps.length < 3) return 0; const ys = ps.map(p => P(p,'nose').y); return band(Math.max(...ys) - Math.min(...ys), .03, .5, .03); })],
   need:['nose'], frame:'Fit everyone in the frame', tips:['Turn shoulders in toward the center','Front row can crouch slightly'],
   target:{multi:[fig({},-.28,.62,.06), fig({},0,.62,-.02), fig({},.28,.62,.06)]}, start:{multi:[fig({},-.36,.6,.08), fig({},0,.6,.08), fig({},.36,.6,.08)]}},
  {id:'selfie', name:'Selfie', blurb:'Arm length, angle from above', icon:'M28 14a7 7 0 1 1 0 14a7 7 0 1 1 0-14M14 54c1-12 7-20 14-20M42 30l8-16h6v8h-6', crop:'bust',
   steps:[C('Hold the phone a little above eye level', ps => { const p = first(ps); const eyeY = (P(p,'le').y+P(p,'re').y)/2; return band(eyeY, .3, .55, .15); }), chinDown, headTilt, shoulderTurnBust],
   need:['nose','le','re'], frame:'Hold the phone at arm length so your face fits', tips:['Face a window for soft light','Small smile, relax your eyes'],
   target: fig({h:[.48,.42],n:[.48,.58],ls:[.3,.66],rs:[.64,.64],le:[.22,.95],re:[.82,.52],lw:[.22,1.2],rw:[.92,.3],lh:[.4,1.2],rh:[.6,1.2],lk:[.4,1.3],rk:[.6,1.3],la:[.4,1.4],ra:[.6,1.4]}),
   start: fig({h:[.5,.42],n:[.5,.58],ls:[.28,.66],rs:[.72,.66],le:[.22,.95],re:[.8,.95],lw:[.22,1.2],rw:[.8,1.2],lh:[.4,1.2],rh:[.6,1.2],lk:[.4,1.3],rk:[.6,1.3],la:[.4,1.4],ra:[.6,1.4]})},
  {id:'sitting', name:'Sitting', blurb:'Seated, tall back, angled legs', icon:'M26 8a6 6 0 1 1 0 12a6 6 0 1 1 0-12M26 22v18h16v16M26 28l10 8M14 40h14',
   steps:[C('Sit down so your hips and knees are in frame', ps => { const p = first(ps); if (!vis(p,['lhip','rhip','lkn','rkn'])) return 0; const k = Math.min(angle(P(p,'lhip'),P(p,'lkn'),P(p,'lan')), angle(P(p,'rhip'),P(p,'rkn'),P(p,'ran'))); return band(k, 60, 130, 30); }),
     C('Sit up tall, straighten your back', ps => { const p = first(ps); const s = mid(P(p,'lsh'),P(p,'rsh')), h = mid(P(p,'lhip'),P(p,'rhip')); const a = Math.abs(Math.atan2(s.x-h.x, h.y-s.y)*180/Math.PI); return band(a, 0, 12, 10); }),
     shoulderTurn, C('Rest your hands on your knee or lap', ps => { const p = first(ps); const d = Math.min(dist(P(p,'lwr'),P(p,'lkn')), dist(P(p,'rwr'),P(p,'rkn')), dist(P(p,'lwr'),P(p,'lhip')), dist(P(p,'rwr'),P(p,'rhip'))); return band(d / shW(p), 0, .8, .6); }), chinDown],
   need:['nose','lsh','rsh','lhip','rhip'], frame:'Sit so your body from head to knees is in frame', tips:['Sit on the front edge of the seat','Angle your knees away from the camera'],
   target: fig({h:[.48,.2],n:[.48,.29],ls:[.42,.31],rs:[.55,.31],le:[.4,.44],re:[.58,.44],lw:[.5,.55],rw:[.6,.56],lh:[.45,.57],rh:[.53,.57],lk:[.62,.6],rk:[.66,.62],la:[.62,.84],ra:[.68,.85]}), start: fig()},
  {id:'headshot', name:'Professional headshot', blurb:'Close crop, confident and level', icon:'M32 10a9 9 0 1 1 0 18a9 9 0 1 1 0-18M14 56c2-14 10-22 18-22s16 8 18 22M28 36l4 8l4-8', crop:'bust',
   steps:[C('Come closer, fill the top half of the frame', ps => { const p = first(ps); return band(shW(p), .4, 1, .2); }), centered, shoulderTurnBust, levelEyes, chinDown],
   need:['nose','le','re','lsh','rsh'], frame:'Head and shoulders only, camera at eye level', tips:['Squint very slightly for a confident look','Plain background, light from the front'],
   target: fig({h:[.5,.28],n:[.5,.46],ls:[.28,.55],rs:[.68,.52],le:[.2,.9],re:[.76,.9],lw:[.2,1.2],rw:[.76,1.2],lh:[.4,1.2],rh:[.6,1.2],lk:[.4,1.3],rk:[.6,1.3],la:[.4,1.4],ra:[.6,1.4]}),
   start: fig({h:[.5,.36],n:[.5,.52],ls:[.32,.58],rs:[.68,.58],le:[.26,.9],re:[.74,.9],lw:[.26,1.2],rw:[.74,1.2],lh:[.4,1.2],rh:[.6,1.2],lk:[.4,1.3],rk:[.6,1.3],la:[.4,1.4],ra:[.6,1.4]})},
  {id:'outdoor', name:'Beach / outdoor', blurb:'Relaxed, open, hand on hip', icon:'M44 10a6 6 0 1 1 0 12a6 6 0 1 1 0-12M6 50c8-4 14-4 20 0s12 4 20 0s10-4 14 0M26 20v14M26 24l-6 6l6 4M26 24l8-8M26 34l-5 10M26 34l5 10',
   steps:[shoulderTurn, handOnHip, weightBack, softKnee, chinDown], need:['nose','lsh','rsh','lhip','rhip','lkn','rkn','lan','ran'], frame:'Step back so your whole body is in frame',
   tips:['Keep the sun to your side, not behind the camera','Look out toward the horizon for a candid shot'],
   target: fig({ls:[.45,.27],rs:[.57,.28],le:[.36,.38],re:[.62,.41],lw:[.44,.5],rw:[.61,.53],lh:[.46,.53],rh:[.54,.53],lk:[.49,.7],rk:[.53,.7],la:[.46,.88],ra:[.58,.87]}), start: fig()},
];

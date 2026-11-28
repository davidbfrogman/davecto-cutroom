/* Shifty, the Nightshift video's night-shift robot, and the rest of its cast. This project only.
   The master copy is video/Nightshift-retro/shifty.js; each beat folder has a copy (a beat's own files are
   what gets copied into its render folder). Edit the master, then: for d in beats/*; do cp shifty.js $d/; done
   Rows: k ink, p paper, n accent (pink), w window grey, m mid grey, d light grey, . clear. 14 wide, 21 tall. */
(() => {
  const st = document.createElement('style');
  st.textContent = '.pix i.m{background:var(--grey)}.pix i.d{background:var(--win)}';
  document.head.append(st);

  const HATS = {
    hard:   ['....kkkkkk....', '...knnnnnnk...', '..knnnppnnnk..', '.kkkkkkkkkkkk.'],
    dark:   ['....kkkkkk....', '...knnnnnnk...', '..knnnmmnnnk..', '.kkkkkkkkkkkk.'],     // headlamp off
    safari: ['....kkkkkk....', '...kddddddk...', '.kkkkkkkkkkkk.', 'kddddddddddddk'],
    cap:    ['..............', '...kkkkkkk....', '..knnnnnnnk...', '..kkkkkkkkkkk.'],
    fedora: ['....kkkkkk....', '...kkkkkkkk...', '..knnnnnnnnk..', 'kkkkkkkkkkkkkk'],
    beret:  ['..........kk..', '...kkkkkkkk...', '..knnnnnnnnnk.', '...kkkkkkkk...'],
    none:   ['..............', '..............', '..............', '..............'],
  };
  const EYES = {
    open:   ['..kwkkwwkkwk..', '..kwkpwwkpwk..'],
    blink:  ['..kwwwwwwwwk..', '..kwkkwwkkwk..'],
    shades: ['..kkkkkkkkkk..', '..kwkkkkkkwk..'],
    wide:   ['..kkkkwwkkkk..', '..kkpkwwkkpk..'],
    stars:  ['..kwnwwwwnwk..', '..knnnwwnnnk..'],
  };
  const MOUTH = {
    flat:  ['..kwwkkkkwwk..', '..kwwwwwwwwk..'],
    happy: ['..kwkwwwwkwk..', '..kwwkkkkwwk..'],
    o:     ['..kwwwkkwwwk..', '..kwwwkkwwwk..'],
    grin:  ['..kwkkkkkkwk..', '..kwknnnnkwk..'],
  };
  const BODY = {
    down: ['.....kwwk.....', '..kkkkkkkkkk..', '.kwkwwwwwwkwk.', '.kwkwnnnnwkwk.', '.kwkwwwwwwkwk.', '.kkkwwwwwwkkk.', '...kwwwwwwk...'],
    up:   ['.kk..kwwk..kk.', '.kwkkkkkkkkwk.', '..kkwwwwwwkk..', '...kwnnnnwk...', '...kwwwwwwk...', '...kwwwwwwk...', '...kwwwwwwk...'],
    hold: ['.....kwwk.....', '..kkkkkkkkkkkk', '.kwkwwwwwwkkwk', '.kwkwnnnnwk.kk', '.kwkwwwwwwk...', '.kkkwwwwwwk...', '...kwwwwwwk...'],
  };
  const LEGS = {
    a: ['...kkk..kkk...', '...kwk..kwk...', '..kkkk..kkkk..'],
    b: ['..kkk....kkk..', '..kwk....kwk..', '.kkkk....kkkk.'],
    c: ['....kkkkkk....', '....kwkkwk....', '...kkkkkkkk...'],
  };
  const SKULL = ['..kppppppppk..', '..kpkkppkkpk..', '..kpkkppkkpk..', '..kppppppppk..', '..kpkpkpkppk..', '..kppkpkpkpk..', '...kkkkkkkk...',
                 '.....kppk.....', '..kkkkkkkkkk..', '.kpkpkkkkpkpk.', '.kpkkppppkkpk.', '.kpkpkkkkpkpk.', '.kkkkppppkkkk.', '...kpkkkkpk...',
                 '...kkk..kkk...', '...kpk..kpk...', '..kkkk..kkkk..'];

  const SH = (window.SH = {});
  /** Shifty's rows. hat, eyes, mouth, body, legs: keys above. */
  SH.rows = ({ hat = 'hard', eyes = 'open', mouth = 'flat', body = 'down', legs = 'a' } = {}) => [
    ...HATS[hat], '..kwwwwwwwwk..', ...EYES[eyes], '..kwwwwwwwwk..', ...MOUTH[mouth], '...kkkkkkkk...', ...BODY[body], ...LEGS[legs]];
  SH.skeleton = (hat = 'hard') => [...HATS[hat], ...SKULL];
  SH.pix = (o, cell = 0.8) => R.pix(SH.rows(o), cell);
  /** Flip-book frames (R.flip): SH.anim([{...}, {...}], cell). */
  SH.anim = (list, cell = 0.8) => R.pixAnim(list.map(o => (Array.isArray(o) ? o : SH.rows(o))), cell);
  SH.W = 14; SH.H = 21;   // in cells
  /** R.flash, but pink stays pink: R.flash inverts, and inverted pink is green. This inverts the lightness only. */
  SH.flash = (el, t, n = 2) => {
    for (let i = 0; i < n; i++) {
      R.tl.set(el, { filter: 'invert(1) hue-rotate(180deg)' }, R.T(t) + i * 2 * R.F);
      R.tl.set(el, { filter: 'none' }, R.T(t) + (i * 2 + 1) * R.F);
    }
  };

  /* props */
  SH.coin = ['.kkk.', 'knnnk', 'knpnk', 'knnnk', '.kkk.'];
  SH.moon = ['..kkkk..', '.kppk...', 'kppk....', 'kppk....', 'kppk....', 'kppk....', '.kppk...', '..kkkk..'];
  SH.snail = (shell = 'w') => ['..kkkk....', '.kSSSSk...', 'kSkkkSk.k.', 'kSkSSSk.k.', 'kSSSSSkkkk', 'kkkkkkkwwk', '.kkkkkkkk.'].map(r => r.replace(/S/g, shell));
  SH.car = ['...kkkkkk.....', '..knnnnnnk....', '.knpnnnnpnk...', 'kkkkkkkkkkkkk.', 'knnnnnnnnnnnk.', 'kkkkkkkkkkkkk.', '.kpk....kpk...', '..k......k....'];
  SH.glove = ['..kkkkkk...', '.knnnnnnk..', 'knnnnnnnnkk', 'knnnnnnnnkw', 'knnnnnnnnkw', '.knnnnnnkkk', '..kkkkkk...'];
  SH.plane = ['k.........', 'kpk.......', 'kppkk.....', 'kpppppkk..', 'kkkkkkkkkk', '.kppppkk..', '..kpkk....', '...k......'];
  SH.trophy = ['..kkkkkkkk..', 'kkknnnnnnkkk', 'k.knnpnnnk.k', 'k.knnpnnnk.k', 'kkknnpnnnkkk', '..knnnnnnk..', '...knnnnk...', '....knnk....', '.....kk.....', '....kkkk....', '...kwwwwk...', '..kkkkkkkk..'];
  SH.hand = ['...kk...', '..kpk...', '..kpk...', '..kpkkk.', 'kkkpkpkk', 'kpkpppppk', '.kpppppk', '..kpppk.'].map(r => r.padEnd(9, '.'));
  SH.net = ['..kkkk..', '.kpkpkk.', 'kpkpkpkk', 'kkpkpkpk', '.kkkkkk.', '....kk..', '....kk..', '....kk..', '....kk..', '....kk..'];
  SH.spray = ['..kk.', '.kmmk', 'knnnk', 'knpnk', 'knnnk', 'knpnk', 'knnnk', 'kkkkk'];
  SH.briefcase = ['...kkkk...', '..k....k..', 'kkkkkkkkkk', 'knnnnnnnnk', 'kkkkkkkkkk', 'knnnnnnnnk', 'kkkkkkkkkk'];
  SH.sign = ['kkkkkkk', 'knnnnnk', 'knkkknk', 'knnnnnk', 'kkkkkkk', '...k...', '...k...', '...k...'];   // "logo"
  SH.web = ['k.....k', '.k...k.', '..kkk..', 'kkk.kkk', '..kkk..', '.k...k.', 'k.....k'];
})();

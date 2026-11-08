"""
lutmatch: measure a look from reference shots, build F-Log2 -> Rec.709 LUTs. Run through ./lm.

  ./lm new <family>                      scaffold families/<family>/look.json
  ./lm frames <family>                   download/copy sources, extract frames, write grids for picking patches
  ./lm boxes <family>                    draw every patch on its frame and print what it measures (check placement)
  ./lm measure <family>                  patches + whole-frame stats -> families/<family>/measured.json
  ./lm build <family> [--camera ID]      fit every look -> families/<family>/luts/ (needs only committed files)
  ./lm check <family> CLIP@T ...         every look on frames of your log clips -> luts/check.png
  ./lm probe CLIP                        camera, log profile and levels of a clip
  ./lm camera-frame CLIP@T [--family F]  a gridded, viewable frame of a log clip, for picking skin boxes
  ./lm camera-add CAMERA CLIP@T --box x0,y0,x1,y1 [--neutral x0,y0,x1,y1] --label TEXT [--curve flog2]
                                         add a skin sample (and a same-light white/grey) to cameras/CAMERA.json
  ./lm test                              offline tests (F-Log2 maths, rebuild == committed cubes, where colours land)
"""
import argparse, glob, json, os, shutil, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAMILIES, CAMERAS = os.path.join(ROOT, 'families'), os.path.join(ROOT, 'cameras')

def fam_dir(name):
    d = os.path.join(FAMILIES, name)
    if not os.path.isdir(d): raise SystemExit(f'No family "{name}" in {FAMILIES}. Start one with: ./lm new {name}')
    return d

def load_spec(name): return json.load(open(os.path.join(fam_dir(name), 'look.json')))
def work(name, *p): return os.path.join(fam_dir(name), 'work', *p)
def dump(obj, path): open(path, 'w').write(json.dumps(obj, indent=1, default=float) + '\n')

def clip_at(s):
    path, _, t = s.rpartition('@')
    if not path: raise SystemExit(f'Give clips as PATH@SECONDS, e.g. ~/Movies/clip.mov@12 (got {s})')
    return os.path.expanduser(path), float(t)

TEMPLATE = {
    "name": "NAME", "camera": "x-t5-flog2",
    "sources": {"ref1": {"url": "https://www.instagram.com/reel/..."}},
    "frames": [{"source": "ref1", "fps": 1, "prefix": "ref1_"}],
    "crop": None, "ignore_rows": None,
    "stats": {"pattern": "ref*_[0-9]*", "skip": [], "stride": 3},
    "patches": [],
    "looks": [{"name": "NAME", "kind": "reference", "soft": 0.6},
              {"name": "tone-only", "kind": "tone-only", "title": "NAME tone only, no colour"}],
}

def cmd_new(a):
    d = os.path.join(FAMILIES, a.family)
    if os.path.exists(os.path.join(d, 'look.json')): raise SystemExit(f'{d}/look.json already exists')
    os.makedirs(d, exist_ok=True)
    dump(json.loads(json.dumps(TEMPLATE).replace('NAME', a.family)), os.path.join(d, 'look.json'))
    print(f'Wrote {d}/look.json. Fill in "sources" and "frames", then: ./lm frames {a.family}')

def cmd_frames(a):
    from .media import fetch, extract, frames_index
    spec = load_spec(a.family)
    fetch(spec['sources'], work(a.family, 'refs'))
    extract(spec, work(a.family, 'refs'), work(a.family, 'frames'))
    names = frames_index(spec, work(a.family, 'frames'), work(a.family, 'grids'))
    print(f'{len(names)} frames. Index: {work(a.family, "grids", "index.png")}  Gridded frames: {work(a.family, "grids")}/<frame>.png')

def measured_patches(spec, family):
    from .measure import measure_patch
    from .media import crop_for
    fr = work(family, 'frames')
    m = lambda p: measure_patch(fr, crop_for(spec, p['frame']), p)
    pats = [m(p) for p in spec['patches']]
    looks = {l['name']: [m(p) for p in l.get('targets', []) + l.get('evidence', [])] for l in spec['looks']}
    return pats, looks

def cmd_boxes(a):
    from .media import boxes_overlay
    spec = load_spec(a.family); pats, looks = measured_patches(spec, a.family)
    allp = pats + [p for v in looks.values() for p in v]
    boxes_overlay(spec, work(a.family, 'frames'), work(a.family, 'grids'), allp)
    for p in allp:
        flags = ' '.join(k for k in ('white_anchor', 'skin_anchor', 'metal') if p.get(k))
        print(f"{p['frame']:10s} {p.get('role', 'target'):8s} {p['label']:30s} RGB {str([round(v) for v in p['rgb']]):16s} "
              f"L {p['L']:.3f} a {p['a']:+.4f} b {p['b']:+.4f} scope {p['scope']:5.1f} {flags}")
    print(f'Overlays: {work(a.family, "grids")}/boxes.png and boxes_<frame>.png. Look at them before measuring.')

def cmd_measure(a):
    from .measure import frame_names, frame_pixels, reference, raised_ceiling, tint_fn
    from .media import crop_for, boxes_overlay
    spec = load_spec(a.family); fr = work(a.family, 'frames'); crop = lambda n: crop_for(spec, n)
    pats, looks = measured_patches(spec, a.family)
    boxes_overlay(spec, fr, work(a.family, 'grids'), pats + [p for v in looks.values() for p in v])
    st = spec['stats']; names = frame_names(fr, st['pattern'], st.get('skip', []))
    lab = frame_pixels(fr, names, crop, spec.get('ignore_rows'), st.get('stride', 3)).astype(np.float32)
    neutral = [p for p in pats if p['role'] == 'neutral']; skin = [p for p in pats if p['role'] == 'skin']
    ref = reference(neutral, skin, lab)
    out = dict(reference=ref, patches=pats, stats_frames=len(names), looks={})
    for l in spec['looks']:
        nt = len(l.get('targets', []))
        e = dict(targets=looks[l['name']][:nt], evidence=looks[l['name']][nt:])
        if 'ceiling_frames' in l:
            cf = l['ceiling_frames']; cn = cf['frames'] if 'frames' in cf else frame_names(fr, cf['pattern'], cf.get('skip', []))
            table, raised = raised_ceiling(frame_pixels(fr, cn, crop, spec.get('ignore_rows'), cf.get('stride', 2)),
                                           tint_fn(ref['tint']), ref['chroma_ceiling']['table'])
            e['ceiling'] = dict(table=table, frames=len(cn), bins_raised=raised)
        out['looks'][l['name']] = e
    dump(out, os.path.join(fam_dir(a.family), 'measured.json'))
    t = ref['tint']
    print(f"{len(names)} frames, {len(neutral)} neutral and {len(skin)} skin patches.")
    print(f"floor L {ref['floor_L']:.3f}  ceiling L {ref['ceiling_L']:.3f}  key skin L {ref['skin_anchor']['L']:.3f}  lit white L {ref['white_anchor']['L']:.3f}")
    print(f"cast fit residual {t['rms_residual']:.4f}  skin scope {ref['skin']['scope_deg']}")
    print(f'Wrote {fam_dir(a.family)}/measured.json. Next: ./lm build {a.family}')

def load_camera(cid):
    p = os.path.join(CAMERAS, f'{cid}.json')
    if not os.path.exists(p): raise SystemExit(f'No camera profile {p}. Add skin samples with ./lm camera-add {cid} ...')
    return json.load(open(p))

def cmd_build(a):
    from .fit import build
    spec = load_spec(a.family); d = fam_dir(a.family)
    measured = json.load(open(os.path.join(d, 'measured.json')))
    camera = load_camera(a.camera or spec['camera'])
    out = os.path.join(d, 'luts')
    if os.path.isdir(out): shutil.rmtree(out)
    report, looks, written = build(spec, measured, camera, out, sizes=tuple(a.sizes))
    for name, r in report.items():
        line = f'{name:12s} {r["kind"]:10s}'
        if 'skin' in r and isinstance(r['skin'], dict):
            s = r['skin']; line += f" skin rot {s.get('rotation_deg', 0):+.1f} gain {s.get('chroma_gain', 1):.2f}"
            if 'scope_of_mean' in s: line += f" -> scope {s['scope_of_mean']:.1f}"
            if 'graded_scope' in s: line += f" -> scope {s['graded_scope']:.1f}"
        if 'pre_wb' in r: line += f" wb {np.round(r['pre_wb'], 3).tolist()} fit {[(f['measured'], f['fitted']) for f in r['fit']]}"
        print(line)
    print(f'{len(written)} cubes in {out}')

def cmd_check(a):
    from .media import graded_frame
    from .flog import LABEL
    spec = load_spec(a.family); out = os.path.join(fam_dir(a.family), 'luts'); tag = LABEL[load_camera(spec['camera'])['curve']]
    cubes = [(l['name'], os.path.join(out, f"{l['name']}_{tag}_to_709.cube")) for l in spec['looks'] if l['kind'] != 'tone-only']
    rows = []
    for c in a.clips:
        path, t = clip_at(c)
        cells = [(f'as shot {os.path.basename(path)}@{t:g}', graded_frame(path, t, None, '540:-2'))]
        cells += [(n, graded_frame(path, t, cube, '540:-2')) for n, cube in cubes]
        rows.append(cells)
    W = 270; H = int(W * rows[0][0][1].height / rows[0][0][1].width)
    s = Image.new('RGB', (W * len(rows[0]), H * len(rows)))
    for r, cells in enumerate(rows):
        for c, (lab, im) in enumerate(cells):
            im = im.resize((W, H)); d = ImageDraw.Draw(im); d.rectangle([0, 0, 8 + 6 * len(lab), 15], fill=0); d.text((4, 2), lab, fill=(255, 255, 255))
            s.paste(im, (c * W, r * H))
    p = os.path.join(out, 'check.png'); s.save(p); print(p)

def cmd_probe(a):
    from .media import probe, log_frame
    from .flog import decode
    path = os.path.expanduser(a.clip); info = probe(path)
    print(json.dumps(info, indent=1))
    if shutil.which('exiftool'):
        print(subprocess.run(['exiftool', '-s', '-Model', '-VideoRecordingMode', '-ISO', '-WhiteBalance', '-FNumber', '-ExposureTime', path], capture_output=True, text=True).stdout)
    else: print('(install exiftool to read the camera and log profile: brew install exiftool)')
    v = log_frame(path, a.t)
    y = v @ np.array([0.2126, 0.7152, 0.0722])
    print('10-bit code levels (luma):', {p: round(float(np.percentile(y, p)) * 1023) for p in (0.1, 1, 50, 99, 99.9)})

def cmd_camera_frame(a):
    from .media import log_frame, grid_image, graded_frame
    path, t = clip_at(a.clip)
    cube = None
    if a.family:
        cands = sorted(glob.glob(os.path.join(fam_dir(a.family), 'luts', '*_to_709.cube')))
        cube = next((c for c in cands if 'clean' in c), cands[0] if cands else None)
    im = graded_frame(path, t, cube) if cube else Image.fromarray((np.clip(log_frame(path, t), 0, 1) * 255).astype(np.uint8))
    os.makedirs(os.path.join(ROOT, 'work'), exist_ok=True)
    p = os.path.join(ROOT, 'work', f'{os.path.splitext(os.path.basename(path))[0]}_{t:g}_grid.png')
    grid_image(im).save(p); print(f'{p}  ({im.width}x{im.height}; boxes are in these pixel coordinates)')

def cmd_camera_add(a):
    from .media import log_frame
    path, t = clip_at(a.clip); v = log_frame(path, t)
    def codes(box):
        x0, y0, x1, y1 = [int(x) for x in box.split(',')]
        return np.round(np.median(v[y0:y1, x0:x1].reshape(-1, 3), 0) * 1023).astype(int).tolist()
    p = os.path.join(CAMERAS, f'{a.camera}.json')
    cam = json.load(open(p)) if os.path.exists(p) else dict(id=a.camera, curve=a.curve, samples=[])
    s = dict(label=f'{a.label}, {os.path.basename(path)} @{t:g}s', codes10=codes(a.box), source=dict(clip=os.path.basename(path), t=t, box=a.box))
    if a.neutral: s.update(neutral_codes10=codes(a.neutral), neutral_label='white/grey surface in the same light'); s['source']['neutral_box'] = a.neutral
    cam['samples'].append(s); os.makedirs(CAMERAS, exist_ok=True); dump(cam, p)
    print(f"{s['label']}: codes {s['codes10']}" + (f"  neutral {s['neutral_codes10']}" if a.neutral else '') + f'  ({len(cam["samples"])} samples in {p})')

def cmd_test(a):
    import unittest
    suite = unittest.defaultTestLoader.discover(os.path.join(ROOT, 'tests'), top_level_dir=ROOT)
    sys.exit(0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1)

def main():
    ap = argparse.ArgumentParser(prog='lm', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    for n in ('new', 'frames', 'boxes', 'measure'): sub.add_parser(n).add_argument('family')
    b = sub.add_parser('build'); b.add_argument('family'); b.add_argument('--camera'); b.add_argument('--sizes', type=int, nargs='+', default=[33, 65])
    c = sub.add_parser('check'); c.add_argument('family'); c.add_argument('clips', nargs='+')
    p = sub.add_parser('probe'); p.add_argument('clip'); p.add_argument('--t', type=float, default=1.0)
    f = sub.add_parser('camera-frame'); f.add_argument('clip'); f.add_argument('--family')
    s = sub.add_parser('camera-add'); s.add_argument('camera'); s.add_argument('clip'); s.add_argument('--box', required=True)
    s.add_argument('--neutral'); s.add_argument('--label', required=True); s.add_argument('--curve', default='flog2')
    sub.add_parser('test')
    a = ap.parse_args()
    {'new': cmd_new, 'frames': cmd_frames, 'boxes': cmd_boxes, 'measure': cmd_measure, 'build': cmd_build, 'check': cmd_check,
     'probe': cmd_probe, 'camera-frame': cmd_camera_frame, 'camera-add': cmd_camera_add, 'test': cmd_test}[a.cmd](a)

if __name__ == '__main__':
    main()

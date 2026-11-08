"""ffmpeg / yt-dlp / image plumbing: fetch references, extract frames, grids and overlays for picking patches."""
import glob, json, os, shutil, subprocess, sys
import numpy as np
from PIL import Image, ImageCms, ImageDraw

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0: raise SystemExit(f'{cmd[0]} failed:\n{r.stderr[-2000:]}')
    return r.stdout

def fetch(sources, refs_dir):
    """Download URLs with yt-dlp, copy local videos. Image sources (screenshots) are read in place."""
    os.makedirs(refs_dir, exist_ok=True)
    for sid, s in sources.items():
        if 'images' in s: continue
        if glob.glob(os.path.join(refs_dir, f'{sid}.*')): continue
        if 'url' in s:
            run([sys.executable, '-m', 'yt_dlp', '-q', '-o', os.path.join(refs_dir, f'{sid}.%(ext)s'), s['url']])
        elif 'file' in s:
            shutil.copy(os.path.expanduser(s['file']), os.path.join(refs_dir, f'{sid}{os.path.splitext(s["file"])[1]}'))

def to_srgb(path):
    """Open an image and convert it to sRGB using its embedded ICC profile (Mac screenshots are Display P3)."""
    im = Image.open(path)
    icc = im.info.get('icc_profile')
    if icc:
        import io
        src = ImageCms.ImageCmsProfile(io.BytesIO(icc)); dst = ImageCms.createProfile('sRGB')
        im = ImageCms.profileToProfile(im.convert('RGB'), src, dst, outputMode='RGB')
    return im.convert('RGB')

def extract(spec, refs_dir, frames_dir):
    os.makedirs(frames_dir, exist_ok=True)
    for e in spec['frames']:
        src = spec['sources'][e['source']]; prefix = e['prefix']; digits = e.get('digits', 3)
        if 'images' in src:
            for i, f in enumerate(sorted(os.path.expanduser(p) for p in src['images']), 1):
                to_srgb(f).save(os.path.join(frames_dir, f'{prefix}{i:0{digits}d}.png'))
            continue
        video = glob.glob(os.path.join(refs_dir, f'{e["source"]}.*'))[0]
        cmd = ['ffmpeg', '-v', 'error', '-y']
        if 'start' in e: cmd += ['-ss', str(e['start'])]
        if 'duration' in e: cmd += ['-t', str(e['duration'])]
        run(cmd + ['-i', video, '-vf', f'fps={e["fps"]}', os.path.join(frames_dir, f'{prefix}%0{digits}d.png')])

def crop_for(spec, frame):
    """The crop for a frame: its frames entry's own crop if it has one, else the family crop."""
    best = None
    for e in spec['frames']:
        if frame.startswith(e['prefix']) and (best is None or len(e['prefix']) > len(best['prefix'])): best = e
    return (best or {}).get('crop', spec.get('crop'))

def open_cropped(spec, frames_dir, name):
    im = Image.open(os.path.join(frames_dir, f'{name}.png')).convert('RGB')
    c = crop_for(spec, name); return im.crop(tuple(c)) if c else im

def grid_image(im, step=100, color=(255, 0, 255)):
    im = im.copy(); d = ImageDraw.Draw(im)
    for x in range(0, im.width, step): d.line([(x, 0), (x, im.height)], fill=color, width=2); d.text((x + 3, 3), str(x), fill=color)
    for y in range(0, im.height, step): d.line([(0, y), (im.width, y)], fill=color, width=2); d.text((3, y + 3), str(y), fill=color)
    return im

def sheet(images, labels, cell_w=200, cols=8):
    cell_h = int(cell_w * images[0].height / images[0].width); rows = (len(images) + cols - 1) // cols
    s = Image.new('RGB', (cols * cell_w, rows * cell_h))
    for i, (im, lab) in enumerate(zip(images, labels)):
        t = im.resize((cell_w, cell_h)); d = ImageDraw.Draw(t); d.rectangle([0, 0, 8 + 6 * len(lab), 14], fill=0); d.text((3, 2), lab, fill=(255, 255, 0))
        s.paste(t, ((i % cols) * cell_w, (i // cols) * cell_h))
    return s

def frames_index(spec, frames_dir, grids_dir):
    """index.png (every frame, named) and a gridded crop of every frame for picking patch boxes."""
    os.makedirs(grids_dir, exist_ok=True)
    names = [os.path.basename(f)[:-4] for f in sorted(glob.glob(os.path.join(frames_dir, '*.png')))]
    ims = [open_cropped(spec, frames_dir, n) for n in names]
    for n, im in zip(names, ims): grid_image(im).save(os.path.join(grids_dir, f'{n}.png'))
    sheet(ims, names).save(os.path.join(grids_dir, 'index.png'))
    return names

def boxes_overlay(spec, frames_dir, grids_dir, patches):
    """Draw every patch box on its frame (boxes_<frame>.png and boxes.png) so placement can be checked by eye."""
    by = {}
    for p in patches: by.setdefault(p['frame'], []).append(p)
    ims, labs = [], []
    for f, ps in by.items():
        im = open_cropped(spec, frames_dir, f); d = ImageDraw.Draw(im)
        for p in ps:
            d.rectangle(tuple(p['box']), outline=(255, 0, 255), width=5); d.text((p['box'][0] + 4, p['box'][1] + 4), p['label'], fill=(255, 0, 255))
        im.save(os.path.join(grids_dir, f'boxes_{f}.png')); ims.append(im); labs.append(f)
    if ims: sheet(ims, labs, cell_w=320, cols=5).save(os.path.join(grids_dir, 'boxes.png'))

# ---- your own log footage ------------------------------------------------------------------------

def probe(clip):
    info = json.loads(run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,width,height,pix_fmt,color_range:format=duration:format_tags',
                           '-of', 'json', clip]))
    return info

def log_frame(clip, t):
    """Raw code values of one frame (no range expansion), autorotated: float array H x W x 3, code/1023 for 10-bit."""
    out = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(t), '-i', clip, '-frames:v', '1', '-vf',
                          'scale=in_range=full:out_range=full:in_color_matrix=bt709,format=rgb48le', '-f', 'rawvideo', '-'],
                         capture_output=True, check=True).stdout
    dims = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation', '-of', 'json', clip])
    s = json.loads(dims)['streams'][0]; w, h = s['width'], s['height']
    rot = abs(int(next((d.get('rotation', 0) for d in s.get('side_data_list', []) if 'rotation' in d), 0)))
    if rot in (90, 270): w, h = h, w
    return np.frombuffer(out, dtype='<u2').reshape(h, w, 3).astype(np.float64) / 65535

def graded_frame(clip, t, cube=None, scale=None):
    """One frame of a clip through a .cube (or as shot when cube is None), as a PIL image."""
    vf = ','.join(([f'lut3d=file={cube}:interp=tetrahedral'] if cube else []) + ([f'scale={scale}'] if scale else [])) or 'null'
    out = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(t), '-i', clip, '-frames:v', '1', '-vf', vf, '-f', 'image2pipe', '-vcodec', 'png', '-'],
                         capture_output=True, check=True).stdout
    import io; return Image.open(io.BytesIO(out)).convert('RGB')

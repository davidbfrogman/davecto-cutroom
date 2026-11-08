"""Offline tests: run with ./lm test. They need only committed files (no reels, no footage)."""
import filecmp, json, os, sys, tempfile, unittest
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from lutmatch.flog import encode, decode, ire, lut_input_to_signal
from lutmatch.colorlib import rgb_to_oklab, scope_angle
from lutmatch.look import Look
from lutmatch.fit import build

FAM = os.path.join(ROOT, 'families', 'olive-teal')
load = lambda *p: json.load(open(os.path.join(*p)))

class FLog2(unittest.TestCase):
    def test_datasheet_levels(self):
        # Fujifilm F-Log2 data sheet: 0% -> 10-bit 95, 18% -> ~400, 90% -> ~570 (code value / 1023)
        self.assertAlmostEqual(float(encode(np.array(0.0), 'flog2')) * 1023, 95.0, delta=0.5)
        self.assertAlmostEqual(float(encode(np.array(0.18), 'flog2')) * 1023, 400.0, delta=1.0)
        self.assertAlmostEqual(float(encode(np.array(0.90), 'flog2')) * 1023, 570.0, delta=1.5)

    def test_round_trip(self):
        r = np.array([0.0005, 0.01, 0.18, 0.9, 8.0])
        np.testing.assert_allclose(decode(encode(r, 'flog2'), 'flog2'), r, rtol=1e-6, atol=1e-9)

    def test_nle_normalisation(self):
        # an NLE hands the LUT legal-range video as (code - 64) / 876
        self.assertAlmostEqual(float(lut_input_to_signal(np.array((400 - 64) / 876))) * 1023, 400.0, places=6)
        self.assertAlmostEqual(ire(0.18, 'flog2'), 38.4, delta=0.2)

class OliveTeal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec, cls.measured = load(FAM, 'look.json'), load(FAM, 'measured.json')
        cls.camera = load(ROOT, 'cameras', cls.spec['camera'] + '.json')
        cls.tmp = tempfile.mkdtemp()
        cls.report, cls.looks, cls.written = build(cls.spec, cls.measured, cls.camera, cls.tmp, sizes=(33,))

    def test_rebuild_matches_committed_cubes(self):
        """Changing the maths changes the LUTs. If that's intended, rebuild and commit the new cubes."""
        committed = sorted(f for f in os.listdir(os.path.join(FAM, 'luts')) if f.endswith('.cube'))
        self.assertTrue(committed, 'no committed cubes to compare with')
        for f in committed:
            self.assertTrue(filecmp.cmp(os.path.join(self.tmp, f), os.path.join(FAM, 'luts', f), shallow=False), f'{f} changed')

    def graded_neutral(self, look, L):
        s = self.looks['olive-teal'].neutral_L_to_scene(L)
        return rgb_to_oklab(self.looks[look].grade_scene(np.array([s, s, s])))

    def test_neutrals_land_on_the_measured_cast(self):
        for p in [p for p in self.measured['patches'] if p['role'] == 'neutral' and not p.get('metal')]:
            o = self.graded_neutral('olive-teal', p['L'])
            # the cast is a smooth fit through noisy real objects: within the fit's own scatter
            self.assertLess(np.hypot(o[1] - p['a'], o[2] - p['b']), 0.03, p['label'])

    def test_variant_targets(self):
        for name in ('warm', 'blue-hour'):
            for t in self.measured['looks'][name]['targets']:
                o = self.graded_neutral(name, t['L'])
                self.assertLess(np.hypot(o[1] - t['a'], o[2] - t['b']), 0.005, f'{name}: {t["label"]}')

    def test_clean_is_neutral(self):
        for L in (0.3, 0.5, 0.7):
            o = self.graded_neutral('clean', L)
            self.assertLess(np.hypot(o[1], o[2]), 0.002)

    def test_skin_lands_on_target(self):
        rep = self.report['olive-teal']['skin']
        self.assertAlmostEqual(rep['graded'][0], rep['target_hue'], places=3)
        self.assertGreater(rep['scope_of_mean'], 120); self.assertLess(rep['scope_of_mean'], 135)
        self.assertAlmostEqual(self.report['clean']['skin']['graded_scope'], 123.0, places=2)

    def test_blue_hour_keeps_skin_warm(self):
        lk = self.looks['blue-hour']; b = lk.skin_inputs(self.camera['samples'])
        from lutmatch.flog import to_709_linear
        rgb = lk.grade_scene(to_709_linear(b, 'flog2'))
        ang, sat = scope_angle(rgb.mean(0))
        self.assertGreater(ang, 115); self.assertLess(ang, 145)   # not pushed teal like the walls

if __name__ == '__main__':
    unittest.main()

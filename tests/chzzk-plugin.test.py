"""Offline regression; no yt-dlp/Python dependency is needed in the shipped app.

Stub only upstream interfaces so we can test manifest handling without network.
The opt-in Electron network test also exercises the real bundled yt-dlp plugin.
"""
import importlib.util
import pathlib
import sys
import types
import unittest
import xml.etree.ElementTree as ET


class Upstream:
    error = 'sourceURL'

    def __init_subclass__(cls, **kwargs):
        pass

    def _parse_mpd_periods(self, *args, **kwargs):
        if self.error:
            raise KeyError(self.error)
        yield {'id': 'upstream', 'formats': [], 'subtitles': {}}

    def write_debug(self, message):
        pass


for name in ('yt_dlp', 'yt_dlp.extractor', 'yt_dlp.extractor.chzzk', 'yt_dlp.utils'):
    sys.modules[name] = types.ModuleType(name)
sys.modules['yt_dlp.extractor.chzzk'].CHZZKVideoIE = Upstream
utils = sys.modules['yt_dlp.utils']
utils.int_or_none = lambda value: int(value) if value else None
utils.float_or_none = lambda value, scale=1: float(value) / scale if value else None
utils.parse_codecs = lambda value: dict(zip(('vcodec', 'acodec'), value.split(',')))
source = pathlib.Path(__file__).resolve().parents[1] / 'src/Worker/yt-dlp-plugins/kawai/yt_dlp_plugins/extractor/kawai_chzzk.py'
spec = importlib.util.spec_from_file_location('plugin', source)
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


def manifest(extra='', url='https://vod.pstatic.net/fixture.mp4', parent=''):
    return ET.fromstring(f'''<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period>{parent}
      <AdaptationSet mimeType="video/mp4">
        <Representation id="PD_720" height="720" codecs="avc1.42,mp4a.40.2">{extra}
          <BaseURL>{url}</BaseURL>
        </Representation>
        <Representation id="broken"><SegmentList><Initialization range="0-118486"/></SegmentList></Representation>
      </AdaptationSet></Period></MPD>''')


class CompatibilityTests(unittest.TestCase):
    def test_source_url_failure_retains_complete_mp4_only(self):
        periods = plugin.KawaiCHZZKVideoIE()._parse_mpd_periods(manifest())
        self.assertEqual(len(periods[0]['formats']), 1)
        selected = periods[0]['formats'][0]
        self.assertEqual(selected['protocol'], 'https')
        self.assertEqual(selected['height'], 720)
        self.assertEqual(selected['acodec'], 'mp4a.40.2')

    def test_never_treats_fragments_or_protected_streams_as_complete_files(self):
        for tag in ('ContentProtection', 'SegmentList', 'SegmentBase', 'SegmentTemplate'):
            self.assertEqual(plugin._progressive_formats(manifest(extra=f'<{tag}/>')), [])
            self.assertEqual(plugin._progressive_formats(manifest(parent=f'<{tag}/>')), [])
        for url in ('file:///etc/passwd', 'https://localhost/a', 'https://pstatic.net.evil.test/a',
                    'http://vod.pstatic.net/a', 'https://user:pass@vod.pstatic.net/a'):
            self.assertEqual(plugin._progressive_formats(manifest(url=url)), [])

    def test_preserves_upstream_success_and_unrelated_errors(self):
        extractor = plugin.KawaiCHZZKVideoIE()
        extractor.error = None
        self.assertEqual(extractor._parse_mpd_periods(manifest())[0]['id'], 'upstream')
        extractor.error = 'other'
        with self.assertRaises(KeyError):
            extractor._parse_mpd_periods(manifest())
        extractor.error = 'sourceURL'
        with self.assertRaises(KeyError):
            extractor._parse_mpd_periods(manifest(extra='<ContentProtection/>'))


if __name__ == '__main__':
    unittest.main()

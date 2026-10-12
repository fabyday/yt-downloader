"""CHZZK-only compatibility for yt-dlp issue #17063 / #8269.

Keep upstream authentication/extraction. If DASH byte-range initialization is
unsupported, use only complete progressive MP4 representations from that same
authorized manifest; never drop initialization ranges or construct media URLs.
"""
from urllib.parse import urlsplit

from yt_dlp.extractor.chzzk import CHZZKVideoIE
from yt_dlp.utils import float_or_none, int_or_none, parse_codecs

__all__ = []


def _progressive_formats(document):
    namespace = document.tag.partition('}')[0] + '}' if '}' in document.tag else ''

    def segmented_or_protected(element):
        return any(element.find(namespace + tag) is not None for tag in (
            'ContentProtection', 'SegmentList', 'SegmentTemplate', 'SegmentBase'))

    if segmented_or_protected(document):
        return []
    periods = document.findall(namespace + 'Period')
    # A progressive file from one period is not necessarily the complete video.
    if len(periods) != 1:
        return []
    formats = []
    for period in periods:
        if segmented_or_protected(period):
            continue
        for adaptation in period.findall(namespace + 'AdaptationSet'):
            if segmented_or_protected(adaptation):
                continue
            for representation in adaptation.findall(namespace + 'Representation'):
                if segmented_or_protected(representation):
                    continue
                attributes = {**adaptation.attrib, **representation.attrib}
                base = representation.find(namespace + 'BaseURL')
                if base is None or not base.text or base.get('byteRange'):
                    continue
                url = base.text.strip()
                parsed = urlsplit(url)
                if (parsed.scheme != 'https' or parsed.username or parsed.password
                        or parsed.port or not (parsed.hostname or '').endswith('.pstatic.net')
                        or attributes.get('mimeType') != 'video/mp4'):
                    continue
                formats.append({
                    'format_id': attributes.get('id'), 'url': url,
                    'protocol': 'https', 'ext': 'mp4',
                    'width': int_or_none(attributes.get('width')),
                    'height': int_or_none(attributes.get('height')),
                    'fps': float_or_none(attributes.get('frameRate')),
                    'tbr': float_or_none(attributes.get('bandwidth'), scale=1000),
                    **parse_codecs(attributes.get('codecs', '')),
                })
    return formats


class KawaiCHZZKVideoIE(CHZZKVideoIE, plugin_name='kawai_chzzk'):
    def _parse_mpd_periods(self, mpd_doc, *args, **kwargs):
        try:
            # Materialize: upstream yields periods and may fail part-way through.
            return list(super()._parse_mpd_periods(mpd_doc, *args, **kwargs))
        except KeyError as error:
            if error.args != ('sourceURL',):
                raise
            formats = _progressive_formats(mpd_doc)
            if not formats:
                raise
            self.write_debug('Using CHZZK progressive MP4 after unsupported DASH initialization')
            return [{'id': 'progressive', 'formats': formats, 'subtitles': {}}]

"""Install pinned optional separators. The application itself requires no Python runtime."""
import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
EXPORTS = ROOT / 'bench/reports/audio-reliability/model-exports'
DEMUCS_SOURCE_SHA = '68d0bf16428ef66e692cdff8a9ccf28f1ef3f69440d57e58605a4cc55fcc5e74'
DEMUCS_SHA = 'a6eabce31c0866a7ad7ac545dc7b12fbe4ccd0c86731e94e99fd5b583da504df'
KIT_SHA = 'e2ec140f5487c79b0be512d705746e2ac017bf3ab06d899d561ca963d91755c2'
# jarredou's MDX23C 5-stem DrumSep weights (CC BY-NC-SA; the checkpoints were published as CC BY-NC-ND)
# as mirrored by EverlastEngineering/DrumToMIDI, with Music-Source-Separation-Training's model code (MIT).
KIT_SOURCES = [
    ('drumsep_5stems_mdx23c_jarredou.ckpt',
     'https://media.githubusercontent.com/media/EverlastEngineering/DrumToMIDI/'
     '62ca57f8335942ebcc1fe6070af4e5249d845369/mdx_models/drumsep_5stems_mdx23c_jarredou.ckpt',
     '1f8e636fb674b88a52c8399fde9a4ebe2b72b065ca07eed4e03ab1c9f0bfb2e0'),
    ('config_mdx23c.yaml',
     'https://raw.githubusercontent.com/EverlastEngineering/DrumToMIDI/'
     '62ca57f8335942ebcc1fe6070af4e5249d845369/mdx_models/config_mdx23c.yaml',
     'd2962f43d6682e8ea84e77fb50a2680e4641ba1749ee95f8ea6e96bba3278944'),
    ('mdx23c_tfc_tdf_v3.py',
     'https://raw.githubusercontent.com/ZFTurbo/Music-Source-Separation-Training/'
     '756168cd51c2edd305d669d042c99d8a52bd3d62/models/mdx23c_tfc_tdf_v3.py',
     '5b29c37cbba4b06e49dcd6bef668d372501df2517392b71b93804355cb7d535e'),
]
KIT_NOTICE = '''drumsep-mdx23c.onnx is an ONNX export of jarredou's MDX23C 5-stem DrumSep model
(kick, snare, toms, hi-hat, cymbals), checkpoint drumsep_5stems_mdx23c_jarredou.ckpt.
The weights are licensed for non-commercial use only (CC BY-NC-SA 4.0; the checkpoints were
published as CC BY-NC-ND 4.0). Do not distribute this export or builds that contain it.
Model code: Music-Source-Separation-Training by Roman Solovyev (ZFTurbo), MIT License.
'''

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def already_verified(path, sha):
    if not path.exists():
        return False
    if digest(path) != sha:
        raise RuntimeError(f'Refusing to overwrite an existing file with a different checksum: {path}')
    return True

def download(url, path, sha):
    if already_verified(path, sha):
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + '.partial')
    print(f'Downloading {path.name}', flush=True)
    with urllib.request.urlopen(url, timeout=90) as response, partial.open('wb') as output:
        shutil.copyfileobj(response, output, length=1024 * 1024)
    if digest(partial) != sha:
        raise RuntimeError(f'Download checksum mismatch: {partial}')
    partial.replace(path)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-dir', type=Path, default=ROOT / 'models')
    args = parser.parse_args()
    models = args.model_dir.resolve()
    models.mkdir(parents=True, exist_ok=True)
    demucs = models / 'htdemucs.onnx'
    original = EXPORTS / 'htdemucs-original.onnx'
    installed_sha = digest(demucs) if demucs.exists() else None
    if installed_sha not in (None, DEMUCS_SHA, DEMUCS_SOURCE_SHA):
        raise RuntimeError(f'Refusing to replace an unrecognized model: {demucs}')
    if installed_sha != DEMUCS_SHA:
        EXPORTS.mkdir(parents=True, exist_ok=True)
        if installed_sha == DEMUCS_SOURCE_SHA and not already_verified(original, DEMUCS_SOURCE_SHA):
            shutil.copyfile(demucs, original)
        download(
            'https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/'
            'd54ed9eb60e258ea82131c6ee14578628816456a/htdemucs.onnx?download=true',
            original, DEMUCS_SOURCE_SHA)
        portable = EXPORTS / 'htdemucs-host-fft.onnx'
        if not already_verified(portable, DEMUCS_SHA):
            subprocess.run([sys.executable, str(ROOT / 'bench/lab/cut-htdemucs-fft.py'),
                            '--source', str(original), '--out', str(portable)], check=True)
        if digest(portable) != DEMUCS_SHA:
            raise RuntimeError('HTDemucs extraction checksum mismatch; use onnx==1.22.0.')
        partial = models / 'htdemucs.onnx.partial'
        shutil.copyfile(portable, partial)
        partial.replace(demucs)
    if not already_verified(models / 'drumsep-mdx23c.onnx', KIT_SHA):
        kit = EXPORTS / 'mdx23c'
        for name, url, sha in KIT_SOURCES:
            download(url, kit / name, sha)
        portable = EXPORTS / 'drumsep-mdx23c.onnx'
        if not already_verified(portable, KIT_SHA):
            subprocess.run([sys.executable, str(ROOT / 'bench/lab/export-mdx23c.py'),
                            f'--ckpt={kit / KIT_SOURCES[0][0]}', f'--config={kit / KIT_SOURCES[1][0]}',
                            f'--model-code={kit}', f'--out={portable}'], check=True)
        if digest(portable) != KIT_SHA:
            raise RuntimeError('MDX23C export checksum mismatch; use torch==2.11.0 and onnx==1.22.0, '
                               'or copy drumsep-mdx23c.onnx from a verified installation.')
        partial = models / 'drumsep-mdx23c.onnx.partial'
        shutil.copyfile(portable, partial)
        partial.replace(models / 'drumsep-mdx23c.onnx')
    (models / 'drumsep-mdx23c.NOTICE').write_text(KIT_NOTICE, encoding='utf-8')
    licenses = [
        ('htdemucs.LICENSE', 'facebookresearch/demucs', 'e976d93ecc3865e5757426930257e200846a520a',
         'cf9b17822d1fcd4ff32ccbe14183386fb3adf6f2ff92dc184130823f7fc28173'),
        ('mdx23c-code.LICENSE', 'ZFTurbo/Music-Source-Separation-Training', '756168cd51c2edd305d669d042c99d8a52bd3d62',
         '3282dc057695ef5b9a64909a7092ca40b2c292c232580fc6ace6e5d665cc0207'),
        ('htdemucs-export.LICENSE', 'StemSplit/demucs-onnx', '85db5c80aba33f0f2bdf88034a4be6539feec85b',
         '002e90589e1030d13e3708342c89faf67b520273793b6a2c77c4d9bd9a5ec7e7'),
    ]
    for name, repository, revision, sha in licenses:
        download(f'https://raw.githubusercontent.com/{repository}/{revision}/LICENSE', models / name, sha)
    print(f'Verified HTDemucs and MDX23C DrumSep installed in {models}', flush=True)

if __name__ == '__main__':
    main()

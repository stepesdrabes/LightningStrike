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
DRUMSEP_SHA = 'e35619cef17d1aeaf410dae9d9895f3814cccc51b7a0deecbf543fe0131d7002'
SOURCE_SHA = '313dcb93e0ed60f52280cd20f2145f32110ffa6f450ce157a69846e16642dd5f'

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
    if not already_verified(models / 'drumsep.onnx', DRUMSEP_SHA):
        download(
            'https://huggingface.co/splitzo/drumsep/resolve/'
            'f510fb1dbdd968e3218f64e8d7ac1af0fafdb6e2/drumsep.onnx?download=true',
            EXPORTS / 'drumsep.onnx', SOURCE_SHA)
        portable = EXPORTS / 'drumsep-portable.onnx'
        if not already_verified(portable, DRUMSEP_SHA):
            subprocess.run([sys.executable, str(ROOT / 'bench/lab/patch-drumsep-onnx.py'),
                            '--source', str(EXPORTS / 'drumsep.onnx'), '--out', str(portable)], check=True)
        if digest(portable) != DRUMSEP_SHA:
            raise RuntimeError('Patched export checksum mismatch; use onnx==1.22.0.')
        partial = models / 'drumsep.onnx.partial'
        shutil.copyfile(portable, partial)
        partial.replace(models / 'drumsep.onnx')
    licenses = [
        ('htdemucs.LICENSE', 'facebookresearch/demucs', 'e976d93ecc3865e5757426930257e200846a520a',
         'cf9b17822d1fcd4ff32ccbe14183386fb3adf6f2ff92dc184130823f7fc28173'),
        ('drumsep.LICENSE', 'inagoy/drumsep', 'c1cea3f47bacd410412c7f563109f0a227b0e784',
         '8b5475f2ece740eea1760ddc4dcc0cecc5087e09d424abd3bbcb8f47a78ba2cd'),
        ('htdemucs-export.LICENSE', 'StemSplit/demucs-onnx', '85db5c80aba33f0f2bdf88034a4be6539feec85b',
         '002e90589e1030d13e3708342c89faf67b520273793b6a2c77c4d9bd9a5ec7e7'),
    ]
    for name, repository, revision, sha in licenses:
        download(f'https://raw.githubusercontent.com/{repository}/{revision}/LICENSE', models / name, sha)
    print(f'Verified HTDemucs and corrected DrumSep installed in {models}', flush=True)

if __name__ == '__main__':
    main()

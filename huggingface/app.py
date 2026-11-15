"""Hugging Face Space entry point. Uses the free Gradio SDK slot (Docker is paid) but not Gradio itself:
downloads the GeoNexus app from GitHub, the private dataset from the HF dataset repo (scripts/fetch_dataset_hf.py,
Space variable DATA_REPO + secret HF_TOKEN), then becomes serve.py on port 7860, the port the Space exposes."""
import io
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

APP = Path.home() / 'GeoNexus-main'
shutil.rmtree(APP, ignore_errors=True)  # the home dir can survive restarts: always take the latest GitHub commit
with urllib.request.urlopen('https://github.com/ikat5/GeoNexus/archive/refs/heads/main.zip') as r:
    zipfile.ZipFile(io.BytesIO(r.read())).extractall(Path.home())
os.chdir(APP)
subprocess.check_call([sys.executable, 'scripts/fetch_dataset_hf.py'])
os.environ['PORT'] = '7860'
try:  # free accounts only get ZeroGPU hardware, which stops a Space that declares no @spaces.GPU function
    import spaces

    @spaces.GPU
    def _gpu_noop():  # never called: the app is CPU-only
        return None

    from spaces.zero.lifecycle import zerogpu_startup
    zerogpu_startup()  # the "startup report" Gradio's server would send; we don't run Gradio
except Exception as e:  # not on ZeroGPU (or spaces internals changed): the server still starts
    print('ZeroGPU startup skipped:', repr(e))
sys.exit(subprocess.call([sys.executable, 'serve.py']))

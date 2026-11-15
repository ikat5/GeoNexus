# Hugging Face Space (Docker SDK). Copy this file and README.md into the Space; it pulls the app from GitHub.
# The private dataset is fetched at container start from a private HF dataset repo (scripts/fetch_dataset_hf.py,
# Space variable DATA_REPO + secret HF_TOKEN), never at build time: anyone can pull a public Space's image.
FROM python:3.14-slim
RUN apt-get update && apt-get install -y --no-install-recommends git git-lfs curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 user
USER user
ENV PATH=/home/user/.local/bin:$PATH PORT=7860
WORKDIR /home/user/app
# shortcut: Docker caches this layer, so new GitHub commits need "Factory rebuild" in the Space settings
RUN git clone --depth 1 https://github.com/ikat5/GeoNexus.git . && pip install --no-cache-dir --user -r requirements.txt huggingface_hub
EXPOSE 7860
CMD ["bash", "-c", "python scripts/fetch_dataset_hf.py && exec python serve.py"]

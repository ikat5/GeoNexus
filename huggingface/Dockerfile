# Hugging Face Space (Docker SDK). Copy this file and README.md into the Space; it pulls the app from GitHub.
# The private dataset is fetched at container start (scripts/render_build.sh, using the DATASET_TOKEN Space secret),
# never at build time: a public Space's image can be pulled by anyone, so it must not contain the dataset.
FROM python:3.14-slim
RUN apt-get update && apt-get install -y --no-install-recommends git git-lfs curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 user
USER user
ENV PATH=/home/user/.local/bin:$PATH PORT=7860
WORKDIR /home/user/app
# shortcut: Docker caches this layer, so new GitHub commits need "Factory rebuild" in the Space settings
RUN git clone --depth 1 https://github.com/ikat5/GeoNexus.git . && pip install --no-cache-dir --user -r requirements.txt
EXPOSE 7860
CMD ["bash", "-c", "bash scripts/render_build.sh && exec python serve.py"]

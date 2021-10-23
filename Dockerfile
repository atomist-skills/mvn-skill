# Set up build
FROM node:lts@sha256:ab6c8cd32006f8a4c1c795e55ddfbc7f54f5a3fb7318506ecb355cab8f5e7182 AS build

WORKDIR /usr/src

COPY . ./

RUN npm ci --no-optional && \
    npm run compile && \
    rm -rf node_modules .git

FROM ubuntu:rolling@sha256:f53c26896aaebc7727f3255c24e261b1b6f630a848a2e67c8cc5848d7c33f93f

# tools
RUN apt-get update && apt-get install -y \
    build-essential=12.8ubuntu3 \
    curl=7.74.0-1ubuntu2 \
    git=1:2.30.2-1ubuntu1 \
    gnupg=2.2.20-1ubuntu3 \
    unzip=6.0-26ubuntu1 \
    wget=1.21-1ubuntu3 \
    zip=3.0-12 \
 && rm -rf /var/lib/apt/lists/*

# sdkman
ENV SDKMAN_DIR /opt/.sdkman
RUN curl -s "https://get.sdkman.io" | bash
RUN echo "sdkman_auto_answer=false" > $SDKMAN_DIR/etc/config

# java
RUN bash -c "source $SDKMAN_DIR/bin/sdkman-init.sh \
    && sdk install java 11.0.11.hs-adpt \
    && java --version"

RUN bash -c "source $SDKMAN_DIR/bin/sdkman-init.sh \
    && sdk install maven"

# node
# atomist:apt-source=deb https://deb.nodesource.com/node_14.x hirsute main
RUN curl -sL https://deb.nodesource.com/setup_14.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR "/skill"

COPY package.json package-lock.json ./

RUN bash -c "npm ci --no-optional \
    && npm cache clean --force"

COPY --from=build /usr/src/ .

WORKDIR "/atm/home"

ENV NODE_NO_WARNINGS 1

ENTRYPOINT ["node", "--no-deprecation", "--no-warnings", "--expose_gc", "--optimize_for_size", "--always_compact", "--max_old_space_size=512", "/skill/node_modules/.bin/atm-skill"]
CMD ["run"]


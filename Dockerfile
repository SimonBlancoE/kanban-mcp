FROM oven/bun:1

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN bun install --production

# Copy source code
COPY src ./src
COPY public ./public
COPY bin ./bin

# Create data directory
RUN mkdir -p data

# Expose web viewer port
EXPOSE 3456

# Run the MCP server
CMD ["bun", "run", "src/index.ts"]

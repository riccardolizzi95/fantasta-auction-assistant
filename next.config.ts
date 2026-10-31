import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Il progetto vive in una cartella con spazi sotto la home: senza questo
  // Turbopack risalirebbe fino alla home per cercare il lockfile.
  turbopack: { root: path.resolve(".") },
};

export default nextConfig;

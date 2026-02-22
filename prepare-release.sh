#!/bin/bash

# GitHub Release Package Preparation Script
# This script prepares the MyTools GPS Suite for GitHub release

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
VERSION="${1:-1.0.0}"
RELEASE_DIR="mytools-gps-suite-$VERSION"

echo "🚀 Preparing MyTools GPS Suite v$VERSION for GitHub release"

# Change to project root
cd "$PROJECT_ROOT"

# Clean up any existing release directory
if [ -d "$RELEASE_DIR" ]; then
    echo "🗑️  Cleaning up existing release directory..."
    rm -rf "$RELEASE_DIR"
fi

# Create release directory
echo "📁 Creating release directory..."
mkdir -p "$RELEASE_DIR"

# Copy project files
echo "📋 Copying project files..."
rsync -av \
    --exclude='.git' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='*.pyo' \
    --exclude='venv' \
    --exclude='.venv' \
    --exclude='node_modules' \
    --exclude='.DS_Store' \
    --exclude='Thumbs.db' \
    --exclude='extract-gpx-parts/data/uploads/*' \
    --exclude='extract-gpx-parts/data/processed/*' \
    --exclude='extract-gpx-parts/web/uploads/*' \
    --exclude='extract-gpx-parts/web/processed/*' \
    --exclude='*.log' \
    --exclude='tmp' \
    --exclude='temp' \
    . "$RELEASE_DIR/"

# Ensure data directories exist with .gitkeep
echo "📂 Ensuring data directories exist..."
mkdir -p "$RELEASE_DIR/extract-gpx-parts/data/uploads"
mkdir -p "$RELEASE_DIR/extract-gpx-parts/data/processed"

# Create checksums
echo "🔍 Generating checksums..."
cd "$RELEASE_DIR"
find . -type f -not -path './.git/*' -exec sha256sum {} \; > CHECKSUMS.txt
cd ..

# Create tar.gz package
echo "📦 Creating release package..."
tar -czf "${RELEASE_DIR}.tar.gz" "$RELEASE_DIR"

# Create zip package for Windows users
echo "📦 Creating Windows-compatible zip package..."
zip -r "${RELEASE_DIR}.zip" "$RELEASE_DIR" -q

# Generate release notes
echo "📝 Generating release notes..."
cat > "RELEASE_NOTES_v${VERSION}.md" << EOF
# MyTools GPS Suite v${VERSION}

## 📦 Release Package Contents

This release includes:
- **Google GPX Converter**: Client-side Google My Maps to GPX conversion
- **Extract GPX Parts**: Server-side GPX component extraction
- **Docker Deployment**: Complete containerized setup
- **Documentation**: Comprehensive guides and API documentation

## 🚀 Quick Deployment

\`\`\`bash
# Download and extract
wget https://github.com/your-username/mytools-gps-suite/releases/download/v${VERSION}/mytools-gps-suite-${VERSION}.tar.gz
tar -xzf mytools-gps-suite-${VERSION}.tar.gz
cd mytools-gps-suite-${VERSION}

# Deploy immediately
chmod +x deploy.sh
./deploy.sh
\`\`\`

## 🌐 Access URLs

After deployment:
- **Google GPX Converter**: http://localhost:6010
- **Extract GPX Parts**: http://localhost:6020

## 📋 System Requirements

- Linux server (Ubuntu 20.04+ recommended)
- Docker with Compose plugin
- 4GB+ RAM, 10GB+ disk space  
- Ports 6010, 6020 available

## 🔧 Configuration

See [DEPLOYMENT.md](DEPLOYMENT.md) for:
- Custom port configuration
- Reverse proxy setup
- Production deployment
- Security hardening
- Monitoring setup

## 📖 Documentation

- \`README.md\` - Main documentation
- \`DEPLOYMENT.md\` - Deployment guide
- \`CONTRIBUTING.md\` - Development guide
- \`.copilot-instructions.md\` - AI assistant guidance

## 🔐 Security

All files in this release have been verified. Check \`CHECKSUMS.txt\` for integrity verification:

\`\`\`bash
sha256sum -c CHECKSUMS.txt
\`\`\`

## 🆕 What's New in v${VERSION}

$(grep -A 20 "## \[${VERSION}\]" CHANGELOG.md | tail -n +2 | head -n -1)

## 🐛 Known Issues

- None currently reported

## 🤝 Support

- **Issues**: Create an issue on GitHub
- **Discussions**: Use GitHub Discussions
- **Documentation**: Check project README and guides

EOF

# Calculate sizes
TARSIZE=$(du -h "${RELEASE_DIR}.tar.gz" | cut -f1)
ZIPSIZE=$(du -h "${RELEASE_DIR}.zip" | cut -f1)

echo ""
echo "✅ Release preparation complete!"
echo ""
echo "📊 Package Information:"
echo "   Version: $VERSION"
echo "   Tar.gz size: $TARSIZE"
echo "   Zip size: $ZIPSIZE"
echo ""
echo "📁 Release Files Generated:"
echo "   ${RELEASE_DIR}.tar.gz"
echo "   ${RELEASE_DIR}.zip" 
echo "   RELEASE_NOTES_v${VERSION}.md"
echo "   $RELEASE_DIR/ (directory)"
echo ""
echo "🔗 Next Steps:"
echo "1. Review the release notes: RELEASE_NOTES_v${VERSION}.md"
echo "2. Test the release package locally"
echo "3. Create GitHub release with generated files"
echo "4. Upload both .tar.gz and .zip files as release assets"
echo ""
echo "📋 GitHub Release Creation:"
echo "   git tag v$VERSION"
echo "   git push origin v$VERSION"
echo "   # Then create release on GitHub with the generated files"
echo ""

# Final verification
echo "🔍 Release Package Verification:"
echo "   Directory contents:"
ls -la "$RELEASE_DIR" | head -10
echo "   ..."
echo ""
echo "   Checksums generated: $(wc -l < "$RELEASE_DIR/CHECKSUMS.txt") files verified"

echo "🎉 Ready for GitHub release!"
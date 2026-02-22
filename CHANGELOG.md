# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release preparation
- GitHub Actions CI/CD pipeline
- Comprehensive documentation

## [1.0.0] - 2026-02-22

### Added
- **Google GPX Converter** application
  - Client-side conversion of Google My Maps (.kmz) to GPX format
  - Drag-drop file upload interface
  - Real-time conversion feedback
  - Responsive web design
  - Complete privacy (client-side processing only)

- **Extract GPX Parts** application
  - Server-side extraction of GPX components (waypoints, tracks, routes)
  - Flask web interface with file upload
  - Batch download capabilities
  - File preview functionality
  - Persistent storage with automatic cleanup
  - CLI tool for command-line usage

- **Docker Infrastructure**
  - Docker Compose deployment configuration
  - Optimized Nginx container for static files
  - Python Flask container with persistent volumes
  - Network isolation and port mapping
  - Automated deployment script

- **Documentation**
  - Comprehensive README with usage examples
  - Detailed deployment guide
  - Contributing guidelines
  - Copilot instructions for both applications
  - License and security information

### Technical Details
- Google GPX Converter runs on port 6010
- Extract GPX Parts runs on port 6020
- Both applications use port 80 internally for consistency
- Persistent data storage under application directories
- Automatic file cleanup after 1 hour
- Support for GPX 1.0 and 1.1 formats
- Responsive design for mobile and desktop

### Deployment
- Single-command deployment via `deploy.sh`
- Docker Compose with health checks
- Persistent volume configuration
- Network security with isolated containers
- Production-ready configuration

## [0.9.0] - 2026-02-21

### Added
- Initial project structure
- Basic Flask application for GPX extraction
- Static HTML converter for Google Maps
- Docker containerization setup

### Changed
- Migrated from standalone scripts to containerized applications
- Improved error handling and user feedback
- Enhanced security with file validation

### Fixed
- JSON serialization issues in Flask templates
- Port conflicts with automatic port detection
- File permission issues in containers

---

## Release Notes

### 1.0.0 Release Highlights

This is the first stable release of MyTools GPS Suite, providing a complete solution for GPS file processing:

#### 🎯 **Key Features**
- **Two Specialized Applications**: Convert and extract GPS data with purpose-built tools
- **Docker-Based Deployment**: One-command setup with persistent storage
- **Privacy-Focused**: Google GPX Converter processes files entirely client-side
- **Production Ready**: Comprehensive error handling and security measures

#### 🔧 **Technical Improvements**
- Optimized container images for faster startup
- Comprehensive test coverage and CI/CD pipeline
- Detailed documentation and deployment guides
- Security scanning and dependency management

#### 🚀 **Deployment**
- **Quick Start**: `git clone && ./deploy.sh`
- **Custom Ports**: 6010 (Google GPX Converter), 6020 (Extract GPX Parts)
- **Persistent Storage**: Automatic data retention and cleanup
- **Monitoring**: Built-in health checks and logging

#### 🔮 **Future Roadmap**
- Additional GPS format support (Garmin, TCX, FIT)
- Advanced batch processing capabilities
- Cloud storage integration
- API expansion for programmatic access
- Real-time collaboration features

---

For detailed upgrade instructions and breaking changes, see [DEPLOYMENT.md](DEPLOYMENT.md).
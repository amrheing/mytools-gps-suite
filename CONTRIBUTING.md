# Contributing to MyTools GPS Suite

We love your input! We want to make contributing to MyTools GPS Suite as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## Development Process

We use GitHub to host code, track issues and feature requests, and accept pull requests.

### Pull Request Process

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code lints
6. Issue that pull request!

## Code Style

### Python (Extract GPX Parts)
- Follow PEP 8 guidelines
- Use type hints where appropriate
- Write descriptive docstrings
- Keep functions focused and small
- Use meaningful variable names

```python
def extract_waypoints(self, output_dir: Path) -> bool:
    """
    Extract waypoints from GPX file and save to separate file.
    
    Args:
        output_dir: Directory to save extracted waypoint file
        
    Returns:
        bool: True if extraction successful, False otherwise
    """
```

### JavaScript (Google GPX Converter)
- Use ES6+ features where supported
- Prefer const/let over var
- Use descriptive function and variable names
- Write comments for complex logic
- Handle errors gracefully

```javascript
const convertKmzToGpx = async (file) => {
    try {
        const kmzData = await readFileAsArrayBuffer(file);
        // Processing logic here
        return generateGpxOutput(processedData);
    } catch (error) {
        console.error('Conversion failed:', error);
        throw new Error(`Failed to convert ${file.name}: ${error.message}`);
    }
};
```

### HTML/CSS
- Use semantic HTML5 elements
- Follow BEM methodology for CSS classes
- Ensure responsive design principles
- Maintain accessibility standards (ARIA labels, etc.)

## Testing Guidelines

### Python Testing
- Write unit tests for core functionality
- Test edge cases and error conditions
- Use meaningful test names that describe the scenario

```python
def test_extract_waypoints_with_valid_gpx():
    """Test waypoint extraction from well-formed GPX file."""
    
def test_extract_waypoints_handles_malformed_xml():
    """Test error handling for corrupted GPX files."""
```

### JavaScript Testing
- Test browser compatibility for core features
- Verify file processing with various input formats
- Test UI interactions and error states

### Docker Testing
- Verify containers build successfully
- Test port mappings and volume mounts
- Ensure services start and respond correctly

## Documentation Standards

### Code Documentation
- Write clear, concise comments
- Document complex algorithms and business logic
- Include examples in documentation when helpful
- Keep documentation up to date with code changes

### API Documentation
- Document all endpoints with examples
- Include expected request/response formats
- Document error codes and messages
- Provide usage examples

## Issue Reporting

### Bug Reports
Create an issue with the following information:

**Bug Description:**
A clear and concise description of the bug.

**Steps to Reproduce:**
1. Go to '...'
2. Click on '....'
3. Scroll down to '....'
4. See error

**Expected Behavior:**
What you expected to happen.

**Screenshots:**
If applicable, add screenshots to help explain the problem.

**Environment:**
- OS: [e.g. Ubuntu 20.04]
- Docker version: [e.g. 20.10.7]
- Browser (if applicable): [e.g. Chrome 91.0]

### Feature Requests

**Feature Description:**
A clear and concise description of the feature you'd like to see.

**Use Case:**
Describe the problem this feature would solve.

**Proposed Solution:**
How you envision this feature working.

**Alternatives Considered:**
Other approaches you've considered.

## Development Environment

### Prerequisites
- Docker with Compose plugin
- Git
- Python 3.13+ (for local development)
- Modern web browser
- Text editor or IDE of choice

### Local Setup

1. **Clone the repository:**
```bash
git clone https://github.com/your-username/mytools-gps-suite.git
cd mytools-gps-suite
```

2. **Set up development environment:**
```bash
# For Python components
cd extract-gpx-parts/web
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# For JavaScript components
cd google-gpx-converter
# Open in browser or serve via local server
python -m http.server 8080
```

3. **Run with Docker:**
```bash
docker compose up -d --build
```

### Making Changes

1. **Create a topic branch:**
```bash
git checkout -b feature/my-new-feature
```

2. **Make your changes and test:**
```bash
# Test Python components
cd extract-gpx-parts/web
python -m pytest

# Test Docker build
docker compose build
docker compose up -d
```

3. **Commit with descriptive messages:**
```bash
git commit -m "feat: add batch processing for large GPX files"
```

4. **Push and create pull request:**
```bash
git push origin feature/my-new-feature
```

## Community Guidelines

### Code of Conduct
- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Respect different viewpoints and experiences

### Communication
- Use clear, concise language in issues and PRs
- Ask questions if requirements are unclear
- Provide context for changes and decisions
- Be patient with code reviews and feedback

## Recognition

Contributors who make significant improvements will be:
- Added to the project's acknowledgments
- Invited to join as project maintainers
- Recognized in release notes

## Questions?

Feel free to contact the maintainers if you have any questions about contributing:
- Create an issue for general questions
- Use GitHub Discussions for broader topics
- Check existing documentation and issues first

Thank you for contributing to MyTools GPS Suite! 🙏
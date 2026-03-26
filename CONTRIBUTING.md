# Contributing to Exca Studio

Thanks for your interest in contributing! 🎨

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/exca-studio.git
   cd exca-studio
   ```
3. Create a feature branch:
   ```bash
   git checkout -b feature/my-feature
   ```

## Development Setup

### Prerequisites
- Go 1.22+
- Node.js 18+
- npm

### Backend
```bash
cd backend
go mod download
go run main.go serve --http=127.0.0.1:8092
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Code Style

### Go (Backend)
- Follow standard Go conventions (`gofmt`, `go vet`)
- Keep functions small and focused
- Add comments for exported functions

### TypeScript (Frontend)
- Use TypeScript strict mode
- Follow React hooks patterns
- Use TailwindCSS for styling (no inline styles)

## Pull Request Process

1. Update documentation if you change functionality
2. Make sure the app builds cleanly:
   ```bash
   # Backend
   cd backend && go build ./...
   
   # Frontend
   cd frontend && npm run build
   ```
3. Write a clear PR description explaining what and why
4. Link any related issues

## Reporting Bugs

Open an issue with:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots (if applicable)
- Browser/OS info

## Feature Requests

Open an issue with:
- Clear description of the feature
- Use case / why it's useful
- Mockups or examples (if applicable)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

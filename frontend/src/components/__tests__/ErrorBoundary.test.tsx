import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

// A component that throws an error
const ErrorComponent = () => {
  throw new Error('Test error');
};

// Define proper type for fallback component props
interface FallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

describe('ErrorBoundary', () => {
  // Mock console methods in beforeAll/afterAll
  
  beforeAll(() => {
    // Mock console methods to avoid test output pollution
    jest.spyOn(console, 'error').mockImplementation(jest.fn());
    jest.spyOn(console, 'log').mockImplementation(jest.fn());
  });
  
  afterEach(() => {
    // Clear all mocks after each test
    jest.clearAllMocks();
  });
  
  afterAll(() => {
    // Restore original console methods
    (console.error as jest.Mock).mockRestore();
    (console.log as jest.Mock).mockRestore();
  });
  
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>Child component</div>
      </ErrorBoundary>
    );
    
    expect(screen.getByText('Child component')).toBeInTheDocument();
  });
  
  it('displays error message when a child component throws an error', () => {
    render(
      <ErrorBoundary>
        <ErrorComponent />
      </ErrorBoundary>
    );
    
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
    expect(screen.getByText('Test error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
  
  it('calls onReset when reset button is clicked', () => {
    const onReset = jest.fn();
    
    render(
      <ErrorBoundary onReset={onReset}>
        <ErrorComponent />
      </ErrorBoundary>
    );
    
    const resetButton = screen.getByRole('button', { name: /try again/i });
    resetButton.click();
    
    expect(onReset).toHaveBeenCalledTimes(1);
  });
  
  it('renders custom fallback component when provided', () => {
    const CustomFallback = ({ error, resetErrorBoundary }: FallbackProps) => (
      <div>
        <h2>Custom Error</h2>
        <p>{error.message}</p>
        <button onClick={resetErrorBoundary}>Retry</button>
      </div>
    );
    
    render(
      <ErrorBoundary FallbackComponent={CustomFallback}>
        <ErrorComponent />
      </ErrorBoundary>
    );
    
    expect(screen.getByText('Custom Error')).toBeInTheDocument();
    expect(screen.getByText('Test error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

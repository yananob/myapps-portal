import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ServiceCard } from '../src/components/ServiceCard';

describe('ServiceCard Component', () => {
  it('renders HTTP app buttons pointing to instance.url', () => {
    render(
      <ServiceCard
        baseName="sample-app"
        main={{ url: 'https://sample-app.run.app', logUrl: 'https://logs/sample-app' }}
        test={{ url: 'https://sample-app-test.run.app', logUrl: 'https://logs/sample-app-test' }}
      />
    );

    const appLinks = screen.getAllByTitle('Open App');
    expect(appLinks).toHaveLength(2);
    expect(appLinks[0]).toHaveAttribute('href', 'https://sample-app.run.app');
    expect(appLinks[1]).toHaveAttribute('href', 'https://sample-app-test.run.app');
  });

  it('renders Event test buttons pointing to testingUrl when available', () => {
    render(
      <ServiceCard
        baseName="sample-event"
        event={{
          url: 'https://sample-event.run.app',
          logUrl: 'https://logs/sample-event',
          testingUrl: 'https://console.cloud.google.com/run/detail/asia-northeast1/sample-event/testing?project=my-pj',
        }}
        testEvent={{
          url: 'https://sample-event-test.run.app',
          logUrl: 'https://logs/sample-event-test',
          testingUrl: 'https://console.cloud.google.com/run/detail/asia-northeast1/sample-event-test/testing?project=my-pj',
        }}
      />
    );

    const testLinks = screen.getAllByTitle('Open Cloud Run Test Page');
    expect(testLinks).toHaveLength(2);
    expect(testLinks[0]).toHaveAttribute(
      'href',
      'https://console.cloud.google.com/run/detail/asia-northeast1/sample-event/testing?project=my-pj'
    );
    expect(testLinks[1]).toHaveAttribute(
      'href',
      'https://console.cloud.google.com/run/detail/asia-northeast1/sample-event-test/testing?project=my-pj'
    );
  });

  it('renders disabled Test button when testingUrl is not available for event service', () => {
    render(
      <ServiceCard
        baseName="sample-event"
        event={{
          url: 'https://sample-event.run.app',
          logUrl: 'https://logs/sample-event',
        }}
      />
    );

    const disabledBtn = screen.getByTitle('Test page not available');
    expect(disabledBtn).toBeInTheDocument();
    expect(disabledBtn).toBeDisabled();
    expect(disabledBtn).toHaveClass('cursor-not-allowed');
  });

  it('renders open PR badge when openPullRequestsCount > 0 and pullRequestsUrl is provided', () => {
    render(
      <ServiceCard
        baseName="sample-pr-app"
        openPullRequestsCount={5}
        pullRequestsUrl="https://github.com/test-owner/sample-pr-app/pulls"
      />
    );

    const prBadge = screen.getByTitle('Open Pull Requests (5)');
    expect(prBadge).toBeInTheDocument();
    expect(prBadge).toHaveAttribute('href', 'https://github.com/test-owner/sample-pr-app/pulls');
    expect(screen.getByText('PR (5)')).toBeInTheDocument();
  });
});

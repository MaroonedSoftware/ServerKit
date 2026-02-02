import { Job } from '@maroonedsoftware/jobbroker';
import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';

interface SendEmailJobPayload {
  to: string;
  subject: string;
  body: string;
  from?: string;
}

/**
 * Send Email Job
 *
 * @description Sends an email to a recipient using the configured email service
 */
@Injectable()
export class SendEmailJob extends Job<SendEmailJobPayload> {
  constructor(private readonly logger: Logger) {
    super('send-email');
  }

  async run(payload: SendEmailJobPayload): Promise<void> {
    this.logger.info('Sending email', {
      to: payload.to,
      subject: payload.subject
    });

    try {
      // TODO: Implement email sending logic
      // const emailService = this.container.get(EmailService);
      // await emailService.send({
      //   to: payload.to,
      //   from: payload.from ?? 'noreply@example.com',
      //   subject: payload.subject,
      //   body: payload.body
      // });

      this.logger.info('Email sent successfully', { to: payload.to });
    } catch (error) {
      this.logger.error('Failed to send email', {
        to: payload.to,
        error
      });
      throw error; // JobBroker will retry based on configuration
    }
  }
}

// Usage example:
//
// In your application bootstrap:
// import { JobBroker } from '@maroonedsoftware/jobbroker';
// import { SendEmailJob } from './jobs/send-email.job';
//
// const jobBroker = new JobBroker({
//   connectionString: process.env.DATABASE_URL!,
//   schema: 'jobs'
// });
//
// const sendEmailJob = container.get(SendEmailJob);
// await jobBroker.register(sendEmailJob, {
//   retryLimit: 3,
//   retryDelay: 60, // seconds
//   expireInSeconds: 3600 // 1 hour
// });
//
// await jobBroker.start();
//
// To queue a job:
// await jobBroker.enqueue('send-email', {
//   to: 'user@example.com',
//   subject: 'Welcome!',
//   body: 'Thanks for signing up.'
// });

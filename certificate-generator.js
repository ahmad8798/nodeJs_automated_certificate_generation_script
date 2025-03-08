const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

// Configuration
const CONFIG = {
  templatePath: './template.pdf',
  outputDir: './certificates',
  csv: {
    path: './recipients.csv',
    delimiter: ','
  },
  text: {
    name: {
      x: 415, // Center of the page X-coordinate
      y: 380, // Y-coordinate for the name
      fontSize: 36,
      color: rgb(0, 0, 0.7), // Navy blue
      fontName: StandardFonts.TimesRomanBold,
      minFontSize: 24 // Minimum font size for long names
    },
    date: {
      x: 670,
      y: 260,
      fontSize: 18,
      color: rgb(0.3, 0.3, 0.3), // Dark gray
      fontName: StandardFonts.TimesRoman
    },
    instructor: {
        x: 150,
        y: 260,
        fontSize: 18,
        color: rgb(0.3, 0.3, 0.3), // Dark gray
        fontName: StandardFonts.TimesRoman
      }
  },
  logging: {
    enabled: true,
    logToFile: true,
    logFilePath: './certificate-generation.log'
  }
};

// Initialize logger
const logger = {
  log: (message, type = 'INFO') => {
    const logMessage = `[${new Date().toISOString()}] [${type}] ${message}`;
    
    if (CONFIG.logging.enabled) {
      console.log(logMessage);
      
      if (CONFIG.logging.logToFile) {
        fs.appendFileSync(CONFIG.logging.logFilePath, logMessage + '\n');
      }
    }
  },
  error: (message) => logger.log(message, 'ERROR'),
  info: (message) => logger.log(message, 'INFO'),
  warn: (message) => logger.log(message, 'WARNING')
};

// Ensure output directory exists
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    logger.info(`Created directory: ${dirPath}`);
  }
}

// Calculate text position and font size based on content length
function calculateTextProperties(text, config) {
  // Clone the config to avoid modifying the original
  const properties = { ...config };
  
  // Adjust font size for long names
  if (text.length > 20) {
    const reductionFactor = Math.min(1, 20 / text.length);
    properties.fontSize = Math.max(
      properties.fontSize * reductionFactor,
      properties.minFontSize || properties.fontSize / 2
    );
  }
  
  return properties;
}

// Draw text on the PDF
async function drawText(page, text, config) {
  if (!text) return;
  
  const properties = calculateTextProperties(text, config);
  const font = await page.doc.embedFont(properties.fontName);
  
  // Calculate text width for centering
  const textWidth = font.widthOfTextAtSize(text, properties.fontSize);
  const xPosition = properties.x - textWidth / 2;
  
  page.drawText(text, {
    x: xPosition,
    y: properties.y,
    size: properties.fontSize,
    font: font,
    color: properties.color
  });
}

// Generate a certificate for a single recipient
async function generateCertificate(recipient) {
  try {
    // Load the PDF template
    const templateBytes = fs.readFileSync(CONFIG.templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const page = pdfDoc.getPages()[0];
    
    // Add recipient details to the PDF
    await drawText(page, recipient.name, CONFIG.text.name);
    await drawText(page, recipient.date, CONFIG.text.date);
    await drawText(page, "Sanket Dhokte", CONFIG.text.instructor);
    // Save the PDF
    const pdfBytes = await pdfDoc.save();
    
    // Generate a valid filename from the recipient's name
    const safeName = recipient.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `Certificate_${safeName}.pdf`;
    const outputPath = path.join(CONFIG.outputDir, filename);
    
    fs.writeFileSync(outputPath, pdfBytes);
    logger.info(`Generated certificate for ${recipient.name}: ${outputPath}`);
    
    return outputPath;
  } catch (error) {
    logger.error(`Failed to generate certificate for ${recipient.name}: ${error.message}`);
    throw error;
  }
}

// Process CSV file and generate certificates
async function processCSV() {
  ensureDirectoryExists(CONFIG.outputDir);
  
  // Initialize log file
  if (CONFIG.logging.enabled && CONFIG.logging.logToFile) {
    fs.writeFileSync(CONFIG.logging.logFilePath, '');
    logger.info('Started certificate generation process');
  }
  
  const recipients = [];
  const errors = [];
  let processed = 0;
  
  return new Promise((resolve, reject) => {
    fs.createReadStream(CONFIG.csv.path)
      .pipe(csv({ separator: CONFIG.csv.delimiter }))
      .on('data', (data) => {
        recipients.push(data);
      })
      .on('end', async () => {
        logger.info(`Found ${recipients.length} recipients in CSV file`);
        
        for (const recipient of recipients) {
          try {
            // Validate required fields
            if (!recipient.name) {
              throw new Error('Missing name field');
            }
            
            await generateCertificate(recipient);
            processed++;
          } catch (error) {
            errors.push({ recipient, error: error.message });
          }
        }
        
        logger.info(`Processed ${processed} certificates with ${errors.length} errors`);
        
        if (errors.length > 0) {
          logger.warn('Some certificates could not be generated:');
          errors.forEach(({ recipient, error }) => {
            logger.warn(`- ${recipient.name || 'Unknown'}: ${error}`);
          });
        }
        
        resolve({
          totalRecipients: recipients.length,
          processed,
          errors
        });
      })
      .on('error', (error) => {
        logger.error(`Error reading CSV file: ${error.message}`);
        reject(error);
      });
  });
}

// Main function
async function main() {
  try {
    logger.info('Starting certificate generation process');
    
    // Verify that template file exists
    if (!fs.existsSync(CONFIG.templatePath)) {
      throw new Error(`Template file not found: ${CONFIG.templatePath}`);
    }
    
    // Process CSV and generate certificates
    const result = await processCSV();
    
    logger.info('Certificate generation completed');
    logger.info(`Total recipients: ${result.totalRecipients}`);
    logger.info(`Successfully processed: ${result.processed}`);
    logger.info(`Errors: ${result.errors.length}`);
    
    return result;
  } catch (error) {
    logger.error(`Certificate generation failed: ${error.message}`);
    process.exit(1);
  }
}

// Run the script if executed directly
if (require.main === module) {
  main();
}

// Export functions for use in other scripts
module.exports = {
  generateCertificate,
  processCSV,
  main
};
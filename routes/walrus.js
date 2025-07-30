import express from 'express';
import multer from 'multer';
import FormData from 'form-data';
import fetch from 'node-fetch';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow image files
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed.'));
    }
  }
});

// Walrus upload endpoint
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    console.log('🐋 Walrus upload request received');
    
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No file uploaded',
        message: 'Please select a file to upload' 
      });
    }

    console.log('📤 Uploading to Walrus:', {
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    });

    // Create FormData for Walrus
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    // Upload to Walrus publisher with fallback endpoints
    console.log('🔄 Sending to Walrus...');
    
    // Only use official Walrus devnet endpoint
    const walrusEndpoints = [
      'https://publisher-devnet.walrus.space/v1/store'
    ];
    
    let walrusResponse;
    let lastError;
    
    for (const endpoint of walrusEndpoints) {
      try {
        console.log(`🔄 Trying endpoint: ${endpoint}`);
        walrusResponse = await fetch(endpoint, {
          method: 'PUT',
          body: formData,
          headers: formData.getHeaders(),
          timeout: 30000 // 30 second timeout
        });
        
        if (walrusResponse.ok) {
          console.log(`✅ Success with endpoint: ${endpoint}`);
          break;
        } else {
          console.log(`❌ Failed with endpoint ${endpoint}: ${walrusResponse.status}`);
          lastError = `${endpoint} returned ${walrusResponse.status}`;
        }
      } catch (error) {
        console.log(`❌ Error with endpoint ${endpoint}:`, error.message);
        lastError = error.message;
        continue;
      }
    }

    if (!walrusResponse || !walrusResponse.ok) {
      // If Walrus is down, provide a development fallback
      if (process.env.NODE_ENV === 'development') {
        console.log('⚠️ Walrus is down, using development fallback');
        
        // Create a mock blob ID for development
        const mockBlobId = 'dev_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        const mockResponse = {
          newlyCreated: {
            blobObject: {
              blobId: mockBlobId
            }
          },
          size: req.file.size,
          contentType: req.file.mimetype,
          originalName: req.file.originalname,
          _mock: true,
          _note: 'This is a mock response. Walrus devnet is currently down.'
        };
        
        console.log('🧪 Returning mock response:', mockResponse);
        return res.json(mockResponse);
      }
      
      const errorText = walrusResponse ? await walrusResponse.text() : lastError;
      console.error('❌ Walrus upload failed:', {
        status: walrusResponse?.status,
        statusText: walrusResponse?.statusText,
        error: errorText
      });
      
      return res.status(walrusResponse?.status || 503).json({
        error: 'Walrus upload failed - service temporarily unavailable',
        details: errorText,
        walrusStatus: walrusResponse?.status || 503,
        suggestion: 'Please try again in a few minutes. Walrus devnet is experiencing connectivity issues.'
      });
    }

    const result = await walrusResponse.json();
    console.log('✅ Walrus response received:', result);

    // Extract blob ID from Walrus response
    let blobId;
    if (result.newlyCreated) {
      blobId = result.newlyCreated.blobObject.blobId;
      console.log('📦 New file created with blob ID:', blobId);
    } else if (result.alreadyCertified) {
      blobId = result.alreadyCertified.blobId;
      console.log('📦 File already exists with blob ID:', blobId);
    } else {
      console.error('❌ Unexpected Walrus response format:', result);
      return res.status(500).json({
        error: 'Unexpected response format from Walrus',
        walrusResponse: result
      });
    }

    // Construct the public URL
    const publicUrl = `https://aggregator-devnet.walrus.space/v1/${blobId}`;

    // Return response in the format the frontend expects
    const responseData = {
      blobId,
      url: publicUrl,
      size: req.file.size,
      contentType: req.file.mimetype,
      originalName: req.file.originalname
    };

    console.log('✅ Upload successful! Returning:', responseData);
    res.json(responseData);

  } catch (error) {
    console.error('❌ Server error during Walrus upload:', error);
    res.status(500).json({
      error: 'Upload failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Test endpoint to verify the upload endpoint is working
router.get('/test', (req, res) => {
  res.json({
    message: 'Walrus upload endpoint is ready!',
    endpoint: '/api/walrus/upload',
    method: 'POST',
    contentType: 'multipart/form-data',
    fieldName: 'file',
    maxFileSize: '10MB',
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
  });
});

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    console.error('❌ Multer error:', error);
    
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        message: 'File size cannot exceed 10MB'
      });
    }
    
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: 'Unexpected file',
        message: 'Only single file uploads are allowed'
      });
    }
  }
  
  if (error.message === 'Invalid file type. Only images are allowed.') {
    return res.status(400).json({
      error: 'Invalid file type',
      message: 'Only image files (JPEG, PNG, GIF, WebP) are allowed'
    });
  }

  // Pass other errors to the next error handler
  next(error);
});

export default router; 
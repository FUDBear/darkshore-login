# Walrus Upload Installation

## 📦 Install Required Packages

Run this in your backend directory:

```bash
npm install multer form-data node-fetch
```

## 🔧 What Was Added

1. **New Route File**: `routes/walrus.js` - Handles Walrus uploads
2. **Updated**: `index.js` - Added Walrus route integration

## 🚀 Start Your Server

```bash
node index.js
```

You should see the new endpoints in the console:
```
🚀 Server running on port 3000
📝 Available endpoints:
   ...
   - POST /api/walrus/upload (Walrus image upload)
   - GET  /api/walrus/test (Walrus endpoint test)
```

## 🧪 Test the Endpoint

1. **Test if it's working**:
   ```bash
   curl http://localhost:3000/api/walrus/test
   ```

2. **Test file upload** (replace with actual image file):
   ```bash
   curl -X POST -F "file=@your-image.png" http://localhost:3000/api/walrus/upload
   ```

## ✅ Next Steps

1. Install the packages above
2. Restart your backend server
3. Go to your frontend app
4. Enable debug mode
5. Try uploading an image in the "🐋 Walrus Image Upload" section
6. It should now work without CORS errors!

## 📋 Package Details

- **multer**: Handles multipart/form-data file uploads
- **form-data**: Creates form data for Walrus API requests  
- **node-fetch**: Makes HTTP requests to Walrus (if not already installed)

## 🐛 Troubleshooting

If you get import errors, make sure your `package.json` has:
```json
{
  "type": "module"
}
```

The endpoints will be available at:
- Upload: `http://localhost:3000/api/walrus/upload`
- Test: `http://localhost:3000/api/walrus/test` 
import React, { useEffect, useState } from 'react';
import { Image } from 'react-native';
import { loadProtectedImage } from '../utils/protectedImage';

const ProtectedImage = ({
  fileUrl,
  token,
  fallback = null,
  onError,
  ...imageProps
}) => {
  const [resource, setResource] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let loadedResource = null;
    setResource(null);
    setFailed(false);

    if (fileUrl && token) {
      loadProtectedImage(fileUrl, token)
        .then((nextResource) => {
          loadedResource = nextResource;
          if (active) setResource(nextResource);
          else nextResource?.dispose?.();
        })
        .catch((error) => {
          if (!active || error?.staleSession) return;
          setFailed(true);
          onError?.(error);
        });
    }

    return () => {
      active = false;
      loadedResource?.dispose?.();
    };
  }, [fileUrl, token, onError]);

  const handleImageError = async (event) => {
    setFailed(true);
    await resource?.invalidate?.();
    onError?.(event);
  };

  if (!resource || failed) return fallback;

  return (
    <Image
      {...imageProps}
      source={resource.source}
      onError={handleImageError}
    />
  );
};

export default ProtectedImage;
